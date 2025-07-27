
document.addEventListener('DOMContentLoaded', () => {
    const chatHistory = document.getElementById('chat-history');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const screenshotButton = document.getElementById('screenshot-button');
    const debugContent = document.getElementById('debug-content');
    const debugPanel = document.getElementById('debug-panel');
    const toggleDebugButton = document.getElementById('toggle-debug');
    const resizer = document.getElementById('resizer');

    let pendingScreenshot = null; // 用于存储待发送的截图数据
    const API_BASE_URL = 'http://127.0.0.1:5001';

    // --- 事件监听 ---

    sendButton.addEventListener('click', sendMessage);
    userInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });

    screenshotButton.addEventListener('click', handleScreenshotClick);

    // --- 启动 ---
    initChat();

    // --- 初始化聊天 ---
    function initChat() {
        addMessage('model', '你好！我是你的文明6助手，请随时截图或提问。');
        connectToLogStream(); // 重新加入这行关键代码
    }

    // --- 核心功能函数 ---

    async function handleScreenshotClick() {
        // 如果已有待发送截图，则不再重复截图
        if (pendingScreenshot) {
            addMessage('system', '已有一张截图待发送。请先输入问题并发送。');
            return;
        }

        addMessage('system', '正在截取屏幕...');
        toggleInput(false);
        try {
            const response = await fetch(`${API_BASE_URL}/screenshot`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            
            pendingScreenshot = data.image; // 保存为待发送状态
            addMessage('user', '', pendingScreenshot); // 在聊天流中显示图片

        } catch (error) {
            console.error('Screenshot failed:', error);
            addMessage('error', `截图失败: ${error.message}`);
        } finally {
            toggleInput(true);
        }
    }

    async function sendMessage() {
        const question = userInput.value.trim();
        if (!question && !pendingScreenshot) {
            addMessage('error', '请输入问题或截取屏幕。');
            return;
        }

        // 如果有待发送的图片，但没有问题，则不发送，等待用户输入
        if (pendingScreenshot && !question) {
            addMessage('system', '请为您的截图输入问题描述。');
            return;
        }

        // 清理掉临时的图片消息（如果存在）
        const tempImgMsg = document.getElementById('temp-screenshot-msg');
        if (tempImgMsg) tempImgMsg.remove();

        // 创建一个包含文本和图片（如果存在）的正式用户消息
        addMessage('user', question, pendingScreenshot);
        
        userInput.value = '';
        toggleInput(false);

        const messageElement = addMessage('model', '');
        const contentElement = messageElement.querySelector('.content');

        try {
            const payload = { question, image: pendingScreenshot };
            const response = await fetch(`${API_BASE_URL}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const chunk = line.substring(6);
                        contentElement.innerHTML += marked.parse(chunk);
                        chatHistory.scrollTop = chatHistory.scrollHeight;
                    }
                }
            }
            if (buffer.startsWith('data: ')) {
                const chunk = buffer.substring(6);
                contentElement.innerHTML += marked.parse(chunk);
            }

        } catch (error) {
            console.error('Chat failed:', error);
            contentElement.innerHTML = `<p style="color: red;">与后端通信失败: ${error.message}</p>`;
        } finally {
            pendingScreenshot = null; // 清空待发送截图
            toggleInput(true);
            chatHistory.scrollTop = chatHistory.scrollHeight;
        }
    }

    // --- UI辅助函数 ---

    function addMessage(role, text, imageBase64 = null) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message');
        if (role === 'user') messageElement.classList.add('user-message');

        const roleElement = document.createElement('div');
        roleElement.classList.add('role');
        roleElement.textContent = role === 'user' ? '你' : '助手';
        if (role === 'error') roleElement.textContent = '系统错误';
        if (role === 'system') roleElement.textContent = '系统消息';

        const contentElement = document.createElement('div');
        contentElement.classList.add('content');
        
        if (text) {
            contentElement.innerHTML = marked.parse(text);
        }

        if (imageBase64) {
            const img = document.createElement('img');
            img.src = `data:image/png;base64,${imageBase64}`;
            img.classList.add('thumbnail');
            contentElement.appendChild(img);
            // 如果是待发送的临时图片，给它一个ID方便移除
            if (role === 'user' && !text) {
                messageElement.id = 'temp-screenshot-msg';
            }
        }

        messageElement.appendChild(roleElement);
        messageElement.appendChild(contentElement);
        chatHistory.appendChild(messageElement);
        chatHistory.scrollTop = chatHistory.scrollHeight;
        return messageElement;
    }

    function toggleInput(enabled) {
        userInput.disabled = !enabled;
        sendButton.disabled = !enabled;
        screenshotButton.disabled = !enabled;
    }

    // --- 调试面板逻辑 (保持不变) ---
    let isResizing = false;
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
    function onMouseMove(e) {
        if (!isResizing) return;
        const newHeight = window.innerHeight - e.clientY;
        if (newHeight > 30 && newHeight < window.innerHeight * 0.8) {
            debugPanel.style.height = `${newHeight}px`;
        }
    }
    function onMouseUp() {
        isResizing = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }
    toggleDebugButton.addEventListener('click', () => {
        const currentHeight = debugPanel.offsetHeight;
        debugPanel.style.height = currentHeight > 30 ? '30px' : '200px';
        toggleDebugButton.textContent = currentHeight > 30 ? '+' : '-';
    });

    // --- 实时日志流 (保持不变) ---
    function connectToLogStream() {
        const eventSource = new EventSource(`${API_BASE_URL}/log-stream`);
        eventSource.onmessage = function(event) {
            const logEntry = document.createElement('div');
            logEntry.textContent = event.data;
            debugContent.appendChild(logEntry);
            debugContent.scrollTop = debugContent.scrollHeight;
        };
        eventSource.onerror = function(err) {
            console.error("Log stream error:", err);
            const errorEntry = document.createElement('div');
            errorEntry.textContent = "[CRITICAL] 后端日志流连接断开...";
            errorEntry.style.color = "red";
            debugContent.appendChild(errorEntry);
            eventSource.close();
        };
    }


});
