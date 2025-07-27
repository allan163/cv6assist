

# -*- coding: utf-8 -*-
import google.generativeai as genai
import os
import io
import configparser
import base64
import time
import logging
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from PIL import ImageGrab

# --- 初始化 Flask 应用 ---
app = Flask(__name__)
CORS(app) # 允许所有来源的跨域请求，方便本地开发

# --- 日志配置 ---
# 创建一个自定义的日志处理器，用于后续的流式传输
class StreamLogHandler(logging.Handler):
    def __init__(self):
        super().__init__()
        self.queue = []

    def emit(self, record):
        log_entry = self.format(record)
        self.queue.append(log_entry)

stream_handler = StreamLogHandler()
# 设置日志格式，包含时间戳
formatter = logging.Formatter('[%(asctime)s] %(message)s', '%H:%M:%S')
stream_handler.setFormatter(formatter)

# 获取Flask的默认logger，并添加我们的处理器
app.logger.addHandler(stream_handler)
app.logger.setLevel(logging.INFO)

# --- 全局变量 ---
model = None
chat_session = None
system_prompt = ""

# --- 配置加载 ---
def load_config():
    config = configparser.ConfigParser()
    if not os.path.exists('config.ini'):
        raise FileNotFoundError("配置文件 config.ini 未找到！")
    config.read('config.ini', encoding='utf-8')
    return config

# --- Gemini 初始化 ---
def init_gemini():
    global model, chat_session, system_prompt
    app.logger.info("正在初始化 Gemini...")
    config = load_config()
    
    api_key = config.get("Gemini", "api_key", fallback=None)
    http_proxy = config.get("Proxy", "http_proxy", fallback=None)
    system_prompt = config.get("Prompt", "system_prompt", fallback="你是一位资深的文明6玩家。")

    if not api_key or api_key == "YOUR_GEMINI_API_KEY":
        raise ValueError("请在 config.ini 文件中设置您的 Gemini API 密钥！")

    if http_proxy:
        app.logger.info(f"使用代理: {http_proxy}")
        os.environ['http_proxy'] = http_proxy
        os.environ['https_proxy'] = http_proxy

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel('gemini-2.5-pro')
    chat_session = model.start_chat(history=[
        {'role': 'user', 'parts': [system_prompt]},
        {'role': 'model', 'parts': ["好的，我已经准备好了。请随时向我展示截图并提出你的问题。"]}
    ])
    app.logger.info("Gemini 初始化成功！")

# --- API 路由 ---

@app.route('/log-stream')
def log_stream():
    def generate():
        while True:
            if stream_handler.queue:
                log_entry = stream_handler.queue.pop(0)
                yield f"data: {log_entry}\n\n"
            time.sleep(0.1) # 每0.1秒检查一次队列
    return Response(generate(), mimetype='text/event-stream')

@app.route('/chat', methods=['POST'])
def handle_chat():
    data = request.json
    question = data.get('question')
    image_b64 = data.get('image') # 接收Base64编码的图片，可能为None

    if not question:
        return jsonify({"error": "问题不能为空"}), 400
    
    app.logger.info(f"收到聊天请求，包含图片: {'是' if image_b64 else '否'}")

    def generate_responses():
        try:
            prompt_parts = [question]
            if image_b64:
                app.logger.info("解码图片数据...")
                image_data = base64.b64decode(image_b64)
                image_part = {"mime_type": "image/png", "data": image_data}
                prompt_parts.append(image_part)
            
            app.logger.info("向Gemini发送流式请求...")
            responses = chat_session.send_message(prompt_parts, stream=True)
            for chunk in responses:
                yield f"data: {chunk.text}\n\n"
            app.logger.info("流式响应结束。")
        except Exception as e:
            app.logger.error(f"流式响应出错: {e}")
            yield f"data: **发生错误**: {e}\n\n"

    return Response(generate_responses(), mimetype='text/event-stream')

@app.route('/screenshot', methods=['GET'])
def take_screenshot():
    app.logger.info("收到截图请求...")
    try:
        screenshot = ImageGrab.grab()
        buffer = io.BytesIO()
        screenshot.save(buffer, format='PNG')
        img_str = base64.b64encode(buffer.getvalue()).decode('utf-8')
        app.logger.info("截图成功并已编码为Base64。")
        return jsonify({"image": img_str})
    except Exception as e:
        app.logger.error(f"截图失败: {e}")
        return jsonify({"error": str(e)}), 500

# --- 启动服务器 ---
if __name__ == '__main__':
    try:
        init_gemini()
        app.run(host='127.0.0.1', port=5001, debug=False) # 在生产环境中关闭debug模式
    except (FileNotFoundError, ValueError) as e:
        print(f"启动失败: {e}")

