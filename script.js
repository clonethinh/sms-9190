        // Global variables
        const API_BASE_URL = `${window.location.protocol}//${window.location.hostname}:8888/cgi-bin`;
        let messages = [];
        let allMessages = [];
        let originalMessages = [];
        let selectedMessages = new Set();
        let currentMessageId = null;
        let lastMessageCount = 0;
        let autoRefreshInterval = null;
        let isAutoRefreshEnabled = false;
        
        // Pagination variables
        let currentPage = 1;
        let itemsPerPage = 20;
        let totalPages = 1;
        
        // Search timeout
        let searchTimeout;
        
        // Unread messages tracking
        let unreadMessages = new Set();

        // Initialize app
        document.addEventListener('DOMContentLoaded', function() {
            loadMessages();
            initializeEventListeners();
            requestNotificationPermission();
            
            // Load unread messages from localStorage
            const saved = localStorage.getItem('unreadMessages');
            if (saved) {
                unreadMessages = new Set(JSON.parse(saved));
            }
        });

        // Event listeners
        function initializeEventListeners() {
            // Keyboard shortcuts
            document.addEventListener('keydown', function(e) {
                if (e.ctrlKey && e.key === 'Enter') {
                    sendSms();
                }
                if (e.key === 'Escape') {
                    closeModal();
                }
                if (e.ctrlKey && e.key === 'a') {
                    e.preventDefault();
                    selectAllMessages();
                }
                if (e.key === 'Delete' && selectedMessages.size > 0) {
                    deleteSelectedMessages();
                }
            });

            // Modal close on outside click
            window.onclick = function(event) {
                const modal = document.getElementById('messageModal');
                if (event.target === modal) {
                    closeModal();
                }
            }

            // Ctrl+Click for multi-select
            document.addEventListener('click', function(e) {
                if (e.target.classList.contains('message-item') && e.ctrlKey) {
                    const checkbox = e.target.querySelector('.message-checkbox');
                    if (checkbox) {
                        checkbox.checked = !checkbox.checked;
                        const messageId = checkbox.getAttribute('data-message-id');
                        toggleMessageSelection(messageId, checkbox);
                        e.target.classList.toggle('selected');
                    }
                }
            });
        }

        // Character count update
        function updateCharCount() {
            const textarea = document.getElementById('messageText');
            const counter = document.getElementById('charCount');
            const current = textarea.value.length;
            counter.textContent = `(${current}/160)`;
            
            if (current > 140) {
                counter.style.color = 'var(--warning-color)';
            } else if (current > 160) {
                counter.style.color = 'var(--danger-color)';
            } else {
                counter.style.color = 'var(--text-muted)';
            }
        }

        // Send SMS function
        async function sendSms() {
            const phoneNumber = document.getElementById('phoneNumber').value.trim();
            const messageText = document.getElementById('messageText').value.trim();
            const sendButton = document.getElementById('sendButton');
            
            if (!phoneNumber || !messageText) {
                showStatusMessage('Vui lòng nhập đầy đủ số điện thoại và nội dung tin nhắn.', 'error');
                return;
            }
            
            if (!isValidPhoneNumber(phoneNumber)) {
                showStatusMessage('Số điện thoại không hợp lệ. Vui lòng kiểm tra lại.', 'error');
                return;
            }
            
            try {
                setButtonLoading(sendButton, true);
                sendButton.classList.add('btn-click-effect');
                
                const url = `${API_BASE_URL}/sms-send?number=${encodeURIComponent(phoneNumber)}&text=${encodeURIComponent(messageText)}`;
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json'
                    }
                });
                
                // Lấy response text trước
                const responseText = await response.text();
                console.log('Raw response:', responseText);
                
                // Parse JSON từ response
                let result;
                try {
                    result = JSON.parse(responseText);
                } catch (parseError) {
                    console.error('JSON parse error:', parseError);
                    console.log('Response was:', responseText);
                    throw new Error('Server trả về dữ liệu không hợp lệ');
                }
                
                // Xử lý kết quả dựa trên JSON response
                if (result.status === 'success') {
                    showStatusMessage('Tin nhắn đã được gửi thành công!', 'success');
                    showActionFeedback(`Đã gửi đến ${result.number}`, 'success');
                    clearForm();
                    
                    // Reload messages after short delay
                    setTimeout(() => {
                        loadMessages();
                    }, 1000);
                    
                } else if (result.status === 'error') {
                    // Xử lý các loại lỗi cụ thể
                    const errorMessage = getDetailedErrorMessage(result);
                    showStatusMessage(errorMessage, 'error');
                    showActionFeedback('Có lỗi xảy ra khi gửi tin nhắn!', 'error');
                    
                    // Log chi tiết lỗi để debug
                    console.error('SMS send error:', {
                        message: result.message,
                        detail: result.detail,
                        signal: result.signal,
                        registration: result.registration
                    });
                } else {
                    throw new Error('Phản hồi từ server không xác định');
                }
                
            } catch (error) {
                console.error('Error sending SMS:', error);
                
                if (error.name === 'TypeError' && error.message.includes('fetch')) {
                    showStatusMessage('Không thể kết nối đến server. Vui lòng kiểm tra kết nối mạng.', 'error');
                } else {
                    showStatusMessage(`Lỗi gửi tin nhắn: ${error.message}`, 'error');
                }
                showActionFeedback('Có lỗi xảy ra khi gửi tin nhắn!', 'error');
            } finally {
                setButtonLoading(sendButton, false);
                setTimeout(() => sendButton.classList.remove('btn-click-effect'), 150);
            }
        }
        
        // Function hỗ trợ để xử lý error message chi tiết
        function getDetailedErrorMessage(result) {
            const errorDetail = result.detail || '';
            
            // Các lỗi phổ biến và thông báo thân thiện
            if (errorDetail.includes('signal')) {
                return 'Tín hiệu mạng quá yếu, không thể gửi SMS. Vui lòng thử lại sau.';
            }
            
            if (errorDetail.includes('registration')) {
                return 'Thiết bị chưa kết nối được với mạng di động. Vui lòng kiểm tra SIM và thử lại.';
            }
            
            if (errorDetail.includes('GDBus.Error:org.freedesktop.libmbim.Error.Status.Failure')) {
                return 'Lỗi kết nối với modem. Có thể do: tín hiệu yếu, SIM bị khóa, hoặc hết tiền. Vui lòng kiểm tra và thử lại.';
            }
            
            if (errorDetail.includes('Couldn\'t send SMS part')) {
                return 'Không thể gửi tin nhắn. Vui lòng kiểm tra: tín hiệu mạng, trạng thái SIM, và số dư tài khoản.';
            }
            
            if (errorDetail.includes('SMS center')) {
                return 'Lỗi cấu hình trung tâm tin nhắn. Vui lòng liên hệ quản trị viên.';
            }
            
            // Lỗi từ server script
            if (result.message === 'Không tìm thấy modem đang hoạt động') {
                return 'Không tìm thấy thiết bị modem. Vui lòng kiểm tra kết nối USB và thử lại.';
            }
            
            if (result.message === 'Thiếu số điện thoại hoặc nội dung') {
                return 'Dữ liệu không hợp lệ. Vui lòng nhập lại số điện thoại và nội dung tin nhắn.';
            }
            
            // Default message
            return result.message || 'Có lỗi không xác định khi gửi tin nhắn. Vui lòng thử lại.';
        }
        
        // Function hiển thị chi tiết lỗi cho admin/debug
        function showDebugInfo(result) {
            if (result.detail || result.signal || result.registration) {
                console.group('Debug Info');
                console.log('Error detail:', result.detail);
                console.log('Signal strength:', result.signal);
                console.log('Registration state:', result.registration);
                console.groupEnd();
                
                // Hiển thị debug info trong UI nếu cần (chỉ cho admin)
                if (window.DEBUG_MODE) {
                    const debugInfo = [
                        result.signal ? `Tín hiệu: ${result.signal}` : null,
                        result.registration ? `Trạng thái mạng: ${result.registration}` : null,
                        result.detail ? `Chi tiết lỗi: ${result.detail}` : null
                    ].filter(Boolean).join(' | ');
                    
                    showStatusMessage(`${result.message} (${debugInfo})`, 'error');
                }
            }
        }


        // Phone number validation
        function isValidPhoneNumber(phone) {
            const cleaned = phone.replace(/\D/g, '');
            return cleaned.length >= 10 && cleaned.length <= 11 && /^[0-9]+$/.test(cleaned);
        }

        // Load messages function
        async function loadMessages() {
            try {
                const response = await fetch(`${API_BASE_URL}/sms-read`);
                const data = await response.text();
                
                if (response.ok) {
                    const parsedMessages = parseSmsData(data);
                    originalMessages = parsedMessages;
                    allMessages = [...parsedMessages];
                    
                    // Check for new messages
                    checkForNewMessages(parsedMessages);
                    
                    // Reset to first page and update
                    currentPage = 1;
                    updatePagination();
                    
                    updateLastLoadTime();
                } else {
                    throw new Error('Không thể tải tin nhắn');
                }
            } catch (error) {
                console.error('Error loading messages:', error);
                showActionFeedback('Không thể tải tin nhắn. Vui lòng thử lại.', 'error');
                
                // Show error state in messages list
                document.getElementById('messagesList').innerHTML = `
                    <div class="text-center text-muted mt-3">
                        <i class="fas fa-exclamation-triangle fa-3x mb-2"></i>
                        <p>Không thể tải tin nhắn. Vui lòng thử lại.</p>
                        <button onclick="loadMessages()" class="btn btn-primary btn-sm">
                            <i class="fas fa-sync-alt"></i> Thử lại
                        </button>
                    </div>
                `;
            }
        }

        // Parse SMS JSON data
        function parseSmsData(data) {
            const messages = [];
            
            try {
                // Parse JSON response
                const jsonData = JSON.parse(data);
                
                if (jsonData.error) {
                    console.error('API Error:', jsonData.error);
                    showActionFeedback('Lỗi API: ' + jsonData.error, 'error');
                    return [];
                }
                
                if (!jsonData.messages || !Array.isArray(jsonData.messages)) {
                    console.warn('Invalid JSON format:', jsonData);
                    return [];
                }
                
                jsonData.messages.forEach((msg, index) => {
                    try {
                        // Map JSON fields to our internal format
                        const mappedMessage = {
                            id: msg.id.toString(),
                            type: mapMessageType(msg.type, msg.state),
                            phone: cleanPhoneNumber(msg.number),
                            timestamp: msg.date,
                            content: msg.text || '',
                            isRead: !unreadMessages.has(msg.id.toString()),
                            state: msg.state,
                            storage: msg.storage || 'unknown',
                            pduType: msg.type
                        };
                        
                        messages.push(mappedMessage);
                    } catch (error) {
                        console.warn('Error parsing message:', msg, error);
                    }
                });
                
            } catch (error) {
                console.error('Error parsing SMS JSON data:', error);
                console.log('Raw data:', data);
                return [];
            }
            
            // Sort by timestamp (newest first)
            return messages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        }

        // Map message type
        function mapMessageType(type, state) {
            // Tin nhắn đến: type = "deliver", state = "received"
            if (type === 'deliver' || state === 'received') {
                return 'inbox';
            }
            // Tin nhắn gửi: type = "submit", state = "sent"
            if (type === 'submit' || state === 'sent') {
                return 'sent';
            }
            
            // Fallback
            return type === 'deliver' ? 'inbox' : 'sent';
        }

        // Clean phone number
        function cleanPhoneNumber(number) {
            if (!number) return '';
            
            // Remove whitespace and special characters
            let cleaned = number.replace(/\s+/g, '').trim();
            
            // Convert +84 to 0
            if (cleaned.startsWith('+84')) {
                cleaned = '0' + cleaned.substring(3);
            }
            
            return cleaned;
        }

        // Check for new messages
        function checkForNewMessages(newMessages) {
            const currentCount = newMessages.length;
            
            if (currentCount > lastMessageCount && lastMessageCount > 0) {
                const newCount = currentCount - lastMessageCount;
                showNewMessageNotification(newCount);
                
                // Add new messages to unread set
                newMessages.slice(0, newCount).forEach(msg => {
                    if (msg.type === 'inbox') {
                        unreadMessages.add(msg.id.toString());
                    }
                });
                
                // Save to localStorage
                localStorage.setItem('unreadMessages', JSON.stringify([...unreadMessages]));
            }
            
            lastMessageCount = currentCount;
        }

        // Show new message notification
        function showNewMessageNotification(count) {
            const notification = document.getElementById('newMessageNotification');
            const text = document.getElementById('notificationText');
            const sound = document.getElementById('notificationSound');
            
            text.textContent = `Bạn có ${count} tin nhắn mới!`;
            notification.classList.remove('hidden');
            
            // Play notification sound
            sound.play().catch(e => console.log('Không thể phát âm thanh:', e));
            
            // Auto hide after 5 seconds
            setTimeout(() => {
                notification.classList.add('hidden');
            }, 5000);
        }

        // Dismiss notification
        function dismissNotification() {
            document.getElementById('newMessageNotification').classList.add('hidden');
        }

        // Request notification permission
        async function requestNotificationPermission() {
            if (!('Notification' in window)) return;
            
            try {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    console.log('Push notifications enabled');
                }
            } catch (error) {
                console.log('Push notifications not supported:', error);
            }
        }

        // Show browser notification
        function showBrowserNotification(title, body) {
            if (window.Notification && Notification.permission === 'granted') {
                new Notification(title, {
                    body: body,
                    icon: '/favicon.ico',
                    badge: '/favicon.ico'
                });
            }
        }

        // Render messages for current page
        function displayCurrentPageMessages() {
            const start = (currentPage - 1) * itemsPerPage;
            const end = start + itemsPerPage;
            const pageMessages = allMessages.slice(start, end);
            
            renderMessages(pageMessages);
        }

        // Render messages
        function renderMessages(messagesToRender) {
            const container = document.getElementById('messagesList');
            
            if (messagesToRender.length === 0) {
                container.innerHTML = `
                    <div class="text-center text-muted mt-3">
                        <i class="fas fa-inbox fa-3x mb-2"></i>
                        <p>Không có tin nhắn nào.</p>
                    </div>
                `;
                return;
            }
            
            const messagesHTML = messagesToRender.map(message => {
                const isUnread = unreadMessages.has(message.id.toString());
                const iconClass = message.type === 'inbox' ? 'fa-arrow-down' : 'fa-arrow-up';
                const typeClass = message.type === 'inbox' ? 'inbox' : 'sent';
                const typeText = message.type === 'inbox' ? 'Đến' : 'Gửi';
                
                // Truncate long messages for display
                const displayText = message.content.length > 100 
                    ? message.content.substring(0, 100) + '...' 
                    : message.content;
                
                // Format storage info
                const storageInfo = message.storage && message.storage !== 'unknown' 
                    ? `<span class="badge badge-info" title="Lưu trữ: ${message.storage}">
                        <i class="fas fa-hdd"></i> ${message.storage.toUpperCase()}
                       </span>` 
                    : '';
                
                return `
                    <div class="message-item ${isUnread ? 'unread' : ''}" 
                         data-id="${message.id}"
                         data-phone="${message.phone}"
                         data-time="${message.timestamp}"
                         data-type="${message.type}"
                         data-content="${message.content.replace(/"/g, '&quot;')}"
                         onclick="showMessageDetail(this)">
                        
                        <input type="checkbox" 
                               class="message-checkbox" 
                               data-message-id="${message.id}"
                               onchange="toggleMessageSelection('${message.id}', this)"
                               onclick="event.stopPropagation()">
                        
                        <div class="message-icon ${typeClass}">
                            <i class="fas ${iconClass}"></i>
                        </div>
                        
                        <div class="message-content">
                            <div class="message-header">
                                <span class="message-phone">
                                    <i class="fas fa-phone"></i>
                                    ${message.phone}
                                </span>
                                <span class="message-time">
                                    <i class="fas fa-clock"></i>
                                    ${formatTimestamp(message.timestamp)}
                                </span>
                            </div>
                            <div class="message-text" title="${message.content}">
                                ${displayText}
                            </div>
                            <div class="message-badges mt-1">
                                <span class="badge badge-${typeClass}">${typeText}</span>
                                ${isUnread ? '<span class="badge badge-success">Mới</span>' : ''}
                                ${storageInfo}
                                <span class="badge badge-secondary" title="Trạng thái: ${message.state}">
                                    <i class="fas fa-info-circle"></i> ${message.state}
                                </span>
                            </div>
                        </div>
                        
                        <div class="message-actions">
                            <button onclick="event.stopPropagation(); showMessageDetail(this.closest('.message-item'))" 
                                    class="btn btn-outline btn-xs" title="Xem chi tiết">
                                <i class="fas fa-eye"></i>
                            </button>
                            ${message.type === 'inbox' ? `
                                <button onclick="event.stopPropagation(); replyToMessage('${message.phone}')" 
                                        class="btn btn-primary btn-xs" title="Trả lời">
                                    <i class="fas fa-reply"></i>
                                </button>
                            ` : ''}
                            <button onclick="event.stopPropagation(); deleteMessage('${message.id}')" 
                                    class="btn btn-danger btn-xs" title="Xóa">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
            
            container.innerHTML = messagesHTML;
        }

// Cập nhật hàm formatTimestamp
function formatTimestamp(timestamp) {
    if (!timestamp) return 'N/A';
    
    try {
        let date;
        
        // Normalize timestamp trước khi parse
        let normalizedTimestamp = normalizeTimestamp(timestamp);
        
        // Xử lý các format timestamp khác nhau
        if (normalizedTimestamp.includes('+07:00') || normalizedTimestamp.includes('+07')) {
            // Format: "2025-07-21T00:51:25+07:00" hoặc "2025-07-21T00:37:29+07"
            date = new Date(normalizedTimestamp);
        } else if (normalizedTimestamp.match(/^\d{4}-\d{2}-\d{2}/)) {
            // Format: "2025-07-21 00:51:25" (không có timezone)
            date = new Date(normalizedTimestamp + '+07:00'); // Thêm timezone Việt Nam
        } else if (normalizedTimestamp.match(/^\d{2}\/\d{2}\/\d{4}/)) {
            // Format: "21/07/2025 00:51:25"
            const parts = normalizedTimestamp.split(' ');
            const dateParts = parts[0].split('/');
            const timePart = parts[1] || '00:00:00';
            date = new Date(`${dateParts[2]}-${dateParts[1]}-${dateParts[0]}T${timePart}+07:00`);
        } else {
            // Fallback: thử parse trực tiếp
            date = new Date(normalizedTimestamp);
        }
        
        // Kiểm tra date có hợp lệ không
        if (isNaN(date.getTime())) {
            console.warn('Invalid timestamp:', timestamp);
            return timestamp; // Trả về raw timestamp nếu không parse được
        }
        
        // Format hiển thị theo yêu cầu: 21/07/2025 - 00:21 AM
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        
        // Format giờ với AM/PM
        const hours24 = date.getHours();
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const hours12 = hours24 === 0 ? 12 : hours24 > 12 ? hours24 - 12 : hours24;
        const ampm = hours24 >= 12 ? 'PM' : 'AM';
        const hoursDisplay = String(hours12).padStart(2, '0');
        
        return `${day}/${month}/${year} - ${hoursDisplay}:${minutes} ${ampm}`;
        
    } catch (error) {
        console.error('Error formatting timestamp:', timestamp, error);
        return timestamp; // Fallback: trả về timestamp gốc
    }
}

		// Cập nhật hàm normalizeTimestamp
		function normalizeTimestamp(timestamp) {
			if (!timestamp) return null;
			
			// Xử lý timezone +07 -> +07:00
			if (timestamp.includes('+07') && !timestamp.includes('+07:00')) {
				timestamp = timestamp.replace(/\+07$/, '+07:00');
			}
			
			// Xử lý timezone -07 -> -07:00 (nếu có)
			if (timestamp.includes('-07') && !timestamp.includes('-07:00')) {
				timestamp = timestamp.replace(/-07$/, '-07:00');
			}
			
			return timestamp;
		}

		// Hàm format cho modal (hiển thị đầy đủ hơn)
		function formatTimestampFull(timestamp) {
			if (!timestamp) return 'N/A';
			
			try {
				let normalizedTimestamp = normalizeTimestamp(timestamp);
				let date = new Date(normalizedTimestamp);
				
				if (isNaN(date.getTime())) {
					return timestamp;
				}
				
				// Format đầy đủ cho modal: "Thứ Hai, 21/07/2025 - 00:21:53 AM"
				const weekdays = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
				const weekday = weekdays[date.getDay()];
				
				const day = String(date.getDate()).padStart(2, '0');
				const month = String(date.getMonth() + 1).padStart(2, '0');
				const year = date.getFullYear();
				
				const hours24 = date.getHours();
				const minutes = String(date.getMinutes()).padStart(2, '0');
				const seconds = String(date.getSeconds()).padStart(2, '0');
				const hours12 = hours24 === 0 ? 12 : hours24 > 12 ? hours24 - 12 : hours24;
				const ampm = hours24 >= 12 ? 'PM' : 'AM';
				const hoursDisplay = String(hours12).padStart(2, '0');
				
				return `${weekday}, ${day}/${month}/${year} - ${hoursDisplay}:${minutes}:${seconds} ${ampm}`;
				
			} catch (error) {
				console.error('Error formatting full timestamp:', timestamp, error);
				return timestamp;
			}
		}


		// Cập nhật hàm showMessageDetail
		function showMessageDetail(messageElement) {
			const modal = document.getElementById('messageModal');
			const phone = messageElement.getAttribute('data-phone');
			const time = messageElement.getAttribute('data-time');
			const type = messageElement.getAttribute('data-type');
			const content = messageElement.getAttribute('data-content');
			const messageId = messageElement.getAttribute('data-id');
			
			currentMessageId = messageId;
			
			document.getElementById('modalPhone').textContent = phone;
			
			// Sử dụng format đầy đủ cho modal
			document.getElementById('modalTime').textContent = formatTimestampFull(time);
			
			document.getElementById('modalType').innerHTML = `
				<span class="badge badge-${type}">${type === 'inbox' ? 'Tin nhắn đến' : 'Tin nhắn gửi'}</span>
			`;
			document.getElementById('modalContent').textContent = content;
			
			// Mark as read
			if (unreadMessages.has(messageId)) {
				unreadMessages.delete(messageId);
				localStorage.setItem('unreadMessages', JSON.stringify([...unreadMessages]));
				messageElement.classList.remove('unread');
			}
			
			// Show detailed status
			const statusElement = document.getElementById('modalStatus');
			statusElement.innerHTML = getDetailedStatus(type, messageElement);
			
			modal.style.display = 'block';
			document.body.style.overflow = 'hidden';
		}


        // Get detailed status
        function getDetailedStatus(type, messageElement) {
            const messageId = messageElement.getAttribute('data-id');
            const isUnread = messageElement.classList.contains('unread');
            
            // Find message data from allMessages array
            const messageData = allMessages.find(msg => msg.id.toString() === messageId);
            
            let statusHTML = '';
            
            if (type === 'inbox') {
                statusHTML = `
                    <span class="badge badge-success">
                        <i class="fas fa-arrow-down"></i>
                        Tin nhắn đến
                    </span>
                    <span class="badge badge-${isUnread ? 'warning' : 'info'}">
                        <i class="fas fa-${isUnread ? 'envelope' : 'envelope-open'}"></i>
                        ${isUnread ? 'Chưa đọc' : 'Đã đọc'}
                    </span>
                `;
            } else {
                statusHTML = `
                    <span class="badge badge-primary">
                        <i class="fas fa-arrow-up"></i>
                        Tin nhắn gửi
                    </span>
                    <span class="badge badge-success">
                        <i class="fas fa-check-circle"></i>
                        Đã gửi thành công
                    </span>
                `;
            }
            
            // Add storage information if available
            if (messageData && messageData.storage && messageData.storage !== 'unknown') {
                statusHTML += `
                    <span class="badge badge-info">
                        <i class="fas fa-hdd"></i>
                        Lưu tại: ${messageData.storage.toUpperCase()}
                    </span>
                `;
            }
            
            return statusHTML;
        }

        // Close modal
        function closeModal() {
            document.getElementById('messageModal').style.display = 'none';
            document.body.style.overflow = 'auto';
            currentMessageId = null;
        }

        // Reply to message
        function replyToMessage(phoneNumber) {
            if (!phoneNumber) {
                phoneNumber = document.getElementById('modalPhone').textContent;
            }
            
            document.getElementById('phoneNumber').value = phoneNumber || '';
            document.getElementById('messageText').focus();
            closeModal();
            
            // Scroll to send form
            document.querySelector('.send-sms-section').scrollIntoView({ 
                behavior: 'smooth' 
            });
            
            showActionFeedback(`Đã điền số ${phoneNumber} vào form gửi tin nhắn`, 'info');
        }

        // Multi-select functions
        function toggleMessageSelection(messageId, checkbox) {
            if (checkbox.checked) {
                selectedMessages.add(messageId);
                checkbox.closest('.message-item').classList.add('selected');
            } else {
                selectedMessages.delete(messageId);
                checkbox.closest('.message-item').classList.remove('selected');
            }
            updateSelectionUI();
        }

        function selectAllMessages() {
            const checkboxes = document.querySelectorAll('.message-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = true;
                const messageId = cb.getAttribute('data-message-id');
                selectedMessages.add(messageId);
                cb.closest('.message-item').classList.add('selected');
            });
            updateSelectionUI();
        }

        function deselectAllMessages() {
            selectedMessages.clear();
            const checkboxes = document.querySelectorAll('.message-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = false;
                cb.closest('.message-item').classList.remove('selected');
            });
            updateSelectionUI();
        }

        function updateSelectionUI() {
            const count = selectedMessages.size;
            const selectionCount = document.getElementById('selectionCount');
            const bulkActions = document.getElementById('bulkActions');
            const selectAllBtn = document.getElementById('selectAllBtn');
            const deselectAllBtn = document.getElementById('deselectAllBtn');
            
            selectionCount.textContent = `${count} tin nhắn được chọn`;
            
            if (count > 0) {
                bulkActions.style.display = 'flex';
                selectAllBtn.style.display = 'none';
                deselectAllBtn.style.display = 'inline-flex';
            } else {
                bulkActions.style.display = 'none';
                selectAllBtn.style.display = 'inline-flex';
                deselectAllBtn.style.display = 'none';
            }
        }

        // Delete functions
	// Cập nhật hàm deleteMessage
		async function deleteMessage(messageId) {
			if (!confirm('Bạn có chắc chắn muốn xóa tin nhắn này?')) return;
			
			try {
				const response = await fetch(`${API_BASE_URL}/sms-delete?ids=${messageId}`);
				const result = await response.json();
				
				if (response.ok && result.success) {
					showActionFeedback(result.message || 'Đã xóa tin nhắn thành công!', 'success');
					
					// Remove from unread set
					unreadMessages.delete(messageId.toString());
					localStorage.setItem('unreadMessages', JSON.stringify([...unreadMessages]));
					
					loadMessages();
					closeModal();
				} else {
					throw new Error(result.message || 'Không thể xóa tin nhắn');
				}
			} catch (error) {
				console.error('Error deleting message:', error);
				
				// Try to parse as JSON if possible
				let errorMessage = 'Không thể xóa tin nhắn. Vui lòng thử lại.';
				try {
					if (error.message) {
						errorMessage = error.message;
					}
				} catch (parseError) {
					// Use default message
				}
				
				showActionFeedback(errorMessage, 'error');
			}
		}

		// Cập nhật hàm deleteSelectedMessages
		async function deleteSelectedMessages() {
			if (selectedMessages.size === 0) {
				showActionFeedback('Vui lòng chọn ít nhất một tin nhắn để xóa.', 'error');
				return;
			}
			
			if (!confirm(`Bạn có chắc chắn muốn xóa ${selectedMessages.size} tin nhắn đã chọn?`)) return;
			
			const deleteBtn = document.querySelector('#bulkActions .btn-danger');
			
			try {
				setButtonLoading(deleteBtn, true);
				
				const ids = Array.from(selectedMessages).join(',');
				const response = await fetch(`${API_BASE_URL}/sms-delete?ids=${ids}`);
				const result = await response.json();
				
				if (response.ok && result.success) {
					showActionFeedback(result.message || `Đã xóa ${selectedMessages.size} tin nhắn thành công!`, 'success');
					
					// Remove from unread set
					selectedMessages.forEach(id => {
						unreadMessages.delete(id.toString());
					});
					localStorage.setItem('unreadMessages', JSON.stringify([...unreadMessages]));
					
					selectedMessages.clear();
					updateSelectionUI();
					loadMessages();
				} else {
					// Handle partial success
					if (result.deleted_count > 0) {
						showActionFeedback(
							`Xóa thành công ${result.deleted_count}/${result.total} tin nhắn. ${result.failed_count} tin nhắn không thể xóa.`, 
							'warning'
						);
						
						// Remove successfully deleted messages from selection and unread set
						if (result.deleted && result.deleted.length > 0) {
							result.deleted.forEach(id => {
								selectedMessages.delete(id.toString());
								unreadMessages.delete(id.toString());
							});
							localStorage.setItem('unreadMessages', JSON.stringify([...unreadMessages]));
							updateSelectionUI();
							loadMessages();
						}
					} else {
						throw new Error(result.message || 'Không thể xóa tin nhắn nào');
					}
				}
			} catch (error) {
				console.error('Error deleting messages:', error);
				
				let errorMessage = 'Không thể xóa tin nhắn. Vui lòng thử lại.';
				try {
					if (error.message) {
						errorMessage = error.message;
					}
				} catch (parseError) {
					// Use default message
				}
				
				showActionFeedback(errorMessage, 'error');
			} finally {
				setButtonLoading(deleteBtn, false);
			}
		}

		// Thêm CSS cho warning feedback
		const warningFeedbackStyle = `
			<style>
				.action-feedback.warning {
					background: var(--warning-color);
					color: white;
				}
				
				.badge-warning {
					background: var(--warning-color);
					color: white;
				}
				
				.status-message.warning {
					background: rgba(255, 193, 7, 0.1);
					color: var(--warning-color);
					border: 1px solid rgba(255, 193, 7, 0.3);
				}
			</style>
		`;

		document.head.insertAdjacentHTML('beforeend', warningFeedbackStyle);

        // Mark selected as read
        function markSelectedAsRead() {
            selectedMessages.forEach(messageId => {
                unreadMessages.delete(messageId.toString());
                const messageElement = document.querySelector(`[data-id="${messageId}"]`);
                if (messageElement) {
                    messageElement.classList.remove('unread');
                }
            });
            
            localStorage.setItem('unreadMessages', JSON.stringify([...unreadMessages]));
            showActionFeedback(`Đã đánh dấu ${selectedMessages.size} tin nhắn là đã đọc!`, 'success');
            
            selectedMessages.clear();
            updateSelectionUI();
        }

        // Search functions
		// Cập nhật hàm performSearch với logic thời gian mới
		function performSearch() {
			clearTimeout(searchTimeout);
			searchTimeout = setTimeout(() => {
				const searchTerm = document.getElementById('searchInput').value.toLowerCase();
				const typeFilter = document.getElementById('typeFilter').value;
				const dateFilter = document.getElementById('dateFilter').value;
				const fromDate = document.getElementById('fromDate').value;
				const toDate = document.getElementById('toDate').value;
				const timeOfDayFilter = document.getElementById('timeOfDayFilter').value;
				const readStatusFilter = document.getElementById('readStatusFilter').value;
				
				let filteredMessages = originalMessages;
				
				// Text search
				if (searchTerm) {
					filteredMessages = filteredMessages.filter(msg => 
						msg.content.toLowerCase().includes(searchTerm) ||
						msg.phone.toLowerCase().includes(searchTerm)
					);
				}
				
				// Type filter
				if (typeFilter) {
					filteredMessages = filteredMessages.filter(msg => msg.type === typeFilter);
				}
				
				// Read status filter
				if (readStatusFilter) {
					filteredMessages = filteredMessages.filter(msg => {
						const isUnread = unreadMessages.has(msg.id.toString());
						return readStatusFilter === 'unread' ? isUnread : !isUnread;
					});
				}
				
				// Time of day filter
				if (timeOfDayFilter) {
					filteredMessages = filterByTimeOfDay(filteredMessages, timeOfDayFilter);
				}
				
				// Date range filters
				if (dateFilter) {
					filteredMessages = filterByDateRange(filteredMessages, dateFilter);
				}
				
				// Custom date range
				if (fromDate || toDate) {
					filteredMessages = filterByCustomDate(filteredMessages, fromDate, toDate);
				}
				
				allMessages = filteredMessages;
				currentPage = 1;
				updatePagination();
				
				// Update UI feedback
				updateFilterFeedback(filteredMessages.length, originalMessages.length, {
					searchTerm, typeFilter, dateFilter, timeOfDayFilter, readStatusFilter
				});
				
			}, 300);
		}

		// Hàm lọc theo giờ trong ngày
		function filterByTimeOfDay(messages, timeFilter) {
			return messages.filter(msg => {
				try {
					const date = new Date(normalizeTimestamp(msg.timestamp));
					const hour = date.getHours();
					
					switch(timeFilter) {
						case 'dawn': return hour >= 5 && hour < 8;     // 5:00-7:59
						case 'morning': return hour >= 8 && hour < 12;  // 8:00-11:59
						case 'afternoon': return hour >= 12 && hour < 18; // 12:00-17:59
						case 'evening': return hour >= 18 && hour < 22;  // 18:00-21:59
						case 'night': return hour >= 22 || hour < 5;     // 22:00-4:59
						default: return true;
					}
				} catch (error) {
					return true; // Keep message if can't parse time
				}
			});
		}

		// Cập nhật hàm filterByDateRange với logic thời gian chính xác
		function filterByDateRange(messages, range) {
			// Current time: Monday, July 21, 2025, 1:26 AM +07
			const now = new Date('2025-07-21T01:26:00+07:00');
			
			return messages.filter(msg => {
				try {
					const msgDate = new Date(normalizeTimestamp(msg.timestamp));
					
					switch (range) {
						case 'today': {
							// 21/07/2025 từ 00:00 đến 23:59
							const startOfToday = new Date('2025-07-21T00:00:00+07:00');
							const endOfToday = new Date('2025-07-21T23:59:59+07:00');
							return msgDate >= startOfToday && msgDate <= endOfToday;
						}
						
						case 'yesterday': {
							// 20/07/2025
							const startOfYesterday = new Date('2025-07-20T00:00:00+07:00');
							const endOfYesterday = new Date('2025-07-20T23:59:59+07:00');
							return msgDate >= startOfYesterday && msgDate <= endOfYesterday;
						}
						
						case 'thisWeek': {
							// Tuần này (Monday 21/07 - Sunday 27/07)
							const startOfWeek = new Date('2025-07-21T00:00:00+07:00'); // Monday
							const endOfWeek = new Date('2025-07-27T23:59:59+07:00');   // Sunday
							return msgDate >= startOfWeek && msgDate <= endOfWeek;
						}
						
						case 'lastWeek': {
							// Tuần trước (Monday 14/07 - Sunday 20/07)
							const startOfLastWeek = new Date('2025-07-14T00:00:00+07:00');
							const endOfLastWeek = new Date('2025-07-20T23:59:59+07:00');
							return msgDate >= startOfLastWeek && msgDate <= endOfLastWeek;
						}
						
						case 'thisMonth': {
							// Tháng 7/2025
							const startOfMonth = new Date('2025-07-01T00:00:00+07:00');
							const endOfMonth = new Date('2025-07-31T23:59:59+07:00');
							return msgDate >= startOfMonth && msgDate <= endOfMonth;
						}
						
						case 'lastMonth': {
							// Tháng 6/2025
							const startOfLastMonth = new Date('2025-06-01T00:00:00+07:00');
							const endOfLastMonth = new Date('2025-06-30T23:59:59+07:00');
							return msgDate >= startOfLastMonth && msgDate <= endOfLastMonth;
						}
						
						case 'last7days': {
							// 7 ngày qua từ hiện tại
							const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
							return msgDate >= sevenDaysAgo && msgDate <= now;
						}
						
						case 'last30days': {
							// 30 ngày qua từ hiện tại
							const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
							return msgDate >= thirtyDaysAgo && msgDate <= now;
						}
						
						default:
							return true;
					}
				} catch (error) {
					console.error('Error in date filtering:', error);
					return true;
				}
			});
		}

		// Quick filter functions
		function setQuickFilter(filterType) {
			// Reset all filters first
			document.getElementById('searchInput').value = '';
			document.getElementById('typeFilter').value = '';
			document.getElementById('fromDate').value = '';
			document.getElementById('toDate').value = '';
			document.getElementById('timeOfDayFilter').value = '';
			document.getElementById('readStatusFilter').value = '';
			
			switch(filterType) {
				case 'today':
					document.getElementById('dateFilter').value = 'today';
					break;
				case 'yesterday':
					document.getElementById('dateFilter').value = 'yesterday';
					break;
				case 'thisWeek':
					document.getElementById('dateFilter').value = 'thisWeek';
					break;
				case 'last24h':
					document.getElementById('dateFilter').value = 'last7days';
					break;
				case 'unreadOnly':
					document.getElementById('readStatusFilter').value = 'unread';
					document.getElementById('dateFilter').value = '';
					break;
			}
			
			performSearch();
			showActionFeedback(`Đã áp dụng bộ lọc: ${getFilterDisplayName(filterType)}`, 'info');
		}

		function clearAllFilters() {
			document.getElementById('searchInput').value = '';
			document.getElementById('typeFilter').value = '';
			document.getElementById('dateFilter').value = '';
			document.getElementById('fromDate').value = '';
			document.getElementById('toDate').value = '';
			document.getElementById('timeOfDayFilter').value = '';
			document.getElementById('readStatusFilter').value = '';
			document.getElementById('clearSearchBtn').style.display = 'none';
			
			allMessages = [...originalMessages];
			currentPage = 1;
			updatePagination();
			
			showActionFeedback('Đã xóa tất cả bộ lọc', 'success');
		}

		// Helper function
		function getFilterDisplayName(filterType) {
			const names = {
				'today': 'Hôm nay',
				'yesterday': 'Hôm qua', 
				'thisWeek': 'Tuần này',
				'last24h': '24 giờ qua',
				'unreadOnly': 'Tin nhắn chưa đọc'
			};
			return names[filterType] || filterType;
		}

		// Enhanced feedback function
		function updateFilterFeedback(filtered, total, filters) {
			const activeFilters = [];
			
			if (filters.searchTerm) activeFilters.push(`"${filters.searchTerm}"`);
			if (filters.typeFilter) activeFilters.push(filters.typeFilter === 'inbox' ? 'Tin đến' : 'Tin gửi');
			if (filters.dateFilter) activeFilters.push(getFilterDisplayName(filters.dateFilter));
			if (filters.timeOfDayFilter) activeFilters.push(filters.timeOfDayFilter);
			if (filters.readStatusFilter) activeFilters.push(filters.readStatusFilter === 'unread' ? 'Chưa đọc' : 'Đã đọc');
			
			let message = `Tìm thấy ${filtered}/${total} tin nhắn`;
			if (activeFilters.length > 0) {
				message += ` với bộ lọc: ${activeFilters.join(', ')}`;
			}
			
			if (filtered < total) {
				showActionFeedback(message, 'info');
			}
		}


        function filterByDateRange(messages, range) {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            
            return messages.filter(msg => {
                const msgDate = new Date(msg.timestamp);
                
                switch (range) {
                    case 'today':
                        return msgDate >= today;
                    case 'yesterday':
                        const yesterday = new Date(today);
                        yesterday.setDate(yesterday.getDate() - 1);
                        return msgDate >= yesterday && msgDate < today;
                    case 'week':
                        const weekStart = new Date(today);
                        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
                        return msgDate >= weekStart;
                    case 'month':
                        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
                        return msgDate >= monthStart;
                    default:
                        return true;
                }
            });
        }

        function filterByCustomDate(messages, fromDate, toDate) {
            return messages.filter(msg => {
                const msgDate = new Date(msg.timestamp);
                const from = fromDate ? new Date(fromDate) : new Date('1970-01-01');
                const to = toDate ? new Date(toDate + 'T23:59:59') : new Date();
                
                return msgDate >= from && msgDate <= to;
            });
        }

        function showSearchResults(filtered, total) {
            if (filtered < total) {
                showActionFeedback(`Tìm thấy ${filtered} trong ${total} tin nhắn`, 'info');
            }
        }

        function clearSearch() {
            document.getElementById('searchInput').value = '';
            document.getElementById('typeFilter').value = '';
            document.getElementById('dateFilter').value = '';
            document.getElementById('fromDate').value = '';
            document.getElementById('toDate').value = '';
            
            allMessages = [...originalMessages];
            currentPage = 1;
            updatePagination();
            
            document.getElementById('clearSearchBtn').style.display = 'none';
        }

        function toggleAdvancedSearch() {
            const panel = document.getElementById('advancedSearchPanel');
            const isVisible = panel.style.display !== 'none';
            panel.style.display = isVisible ? 'none' : 'block';
        }

        // Filter messages by type
        function filterMessages() {
            const filter = document.getElementById('messageFilter').value;
            
            if (filter === 'all') {
                allMessages = [...originalMessages];
            } else {
                allMessages = originalMessages.filter(msg => msg.type === filter);
            }
            
            currentPage = 1;
            updatePagination();
        }

        // Pagination functions
        function updatePagination() {
            totalPages = Math.ceil(allMessages.length / itemsPerPage);
            
            // Ensure current page is valid
            if (currentPage > totalPages) currentPage = Math.max(1, totalPages);
            
            // Update info display
            const start = allMessages.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0;
            const end = Math.min(currentPage * itemsPerPage, allMessages.length);
            
            document.getElementById('itemStart').textContent = start;
            document.getElementById('itemEnd').textContent = end;
            document.getElementById('totalItems').textContent = allMessages.length;
            
            // Update button states
            document.getElementById('firstPageBtn').disabled = currentPage === 1;
            document.getElementById('prevPageBtn').disabled = currentPage === 1;
            document.getElementById('nextPageBtn').disabled = currentPage === totalPages || totalPages === 0;
            document.getElementById('lastPageBtn').disabled = currentPage === totalPages || totalPages === 0;
            
            // Render page numbers
            renderPageNumbers();
            
            // Display messages for current page
            displayCurrentPageMessages();
        }

        function renderPageNumbers() {
            const pageNumbers = document.getElementById('pageNumbers');
            pageNumbers.innerHTML = '';
            
            if (totalPages <= 1) return;
            
            const maxVisible = 5;
            let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
            let endPage = Math.min(totalPages, startPage + maxVisible - 1);
            
            if (endPage - startPage < maxVisible - 1) {
                startPage = Math.max(1, endPage - maxVisible + 1);
            }
            
            for (let i = startPage; i <= endPage; i++) {
                const pageBtn = document.createElement('button');
                pageBtn.className = `page-btn ${i === currentPage ? 'active' : ''}`;
                pageBtn.textContent = i;
                pageBtn.onclick = () => goToPage(i);
                pageNumbers.appendChild(pageBtn);
            }
        }

        function goToPage(page) {
            if (page >= 1 && page <= totalPages) {
                currentPage = page;
                updatePagination();
                
                // Scroll to top of messages list
                document.querySelector('.messages-container').scrollTop = 0;
            }
        }

        function changeItemsPerPage() {
            itemsPerPage = parseInt(document.getElementById('itemsPerPage').value);
            currentPage = 1;
            updatePagination();
        }

        // Auto-refresh functions
        function toggleAutoRefresh() {
            const button = document.querySelector('#autoRefreshText');
            
            if (isAutoRefreshEnabled) {
                clearInterval(autoRefreshInterval);
                isAutoRefreshEnabled = false;
                button.textContent = 'Bật tự động';
                showActionFeedback('Đã tắt tự động tải lại', 'info');
            } else {
                autoRefreshInterval = setInterval(loadMessages, 30000); // 30 seconds
                isAutoRefreshEnabled = true;
                button.textContent = 'Tắt tự động';
                showActionFeedback('Đã bật tự động tải lại (30 giây)', 'info');
            }
        }

        // Export selected messages
        function exportSelectedMessages() {
            if (selectedMessages.size === 0) {
                showActionFeedback('Vui lòng chọn ít nhất một tin nhắn để xuất.', 'error');
                return;
            }
            
            const selectedData = allMessages.filter(msg => selectedMessages.has(msg.id));
            const csvContent = generateCSV(selectedData);
            downloadCSV(csvContent, `sms_export_${new Date().toISOString().slice(0,10)}.csv`);
            
            showActionFeedback(`Đã xuất ${selectedMessages.size} tin nhắn!`, 'success');
        }

        function generateCSV(messages) {
            const headers = ['Loại', 'Số điện thoại', 'Thời gian', 'Nội dung', 'Trạng thái', 'Lưu trữ'];
            const rows = messages.map(msg => [
                msg.type === 'inbox' ? 'Tin nhắn đến' : 'Tin nhắn gửi',
                msg.phone,
                new Date(msg.timestamp).toLocaleString('vi-VN'),
                `"${msg.content.replace(/"/g, '""')}"`,
                msg.state,
                msg.storage || 'unknown'
            ]);
            
            return [headers, ...rows].map(row => row.join(',')).join('\n');
        }

        function downloadCSV(content, filename) {
            const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            link.click();
            URL.revokeObjectURL(link.href);
        }

        // Utility functions
        function showStatusMessage(message, type) {
            const statusDiv = document.getElementById('statusMessage');
            const span = statusDiv.querySelector('span');
            
            statusDiv.className = `status-message ${type}`;
            span.textContent = message;
            statusDiv.classList.remove('hidden');
            
            setTimeout(() => {
                statusDiv.classList.add('hidden');
            }, 5000);
        }

        function showActionFeedback(message, type = 'success') {
            const feedback = document.createElement('div');
            feedback.className = `action-feedback ${type}`;
            feedback.innerHTML = `
                <i class="fas fa-${type === 'success' ? 'check' : type === 'error' ? 'exclamation-triangle' : 'info-circle'}"></i> 
                ${message}
            `;
            
            document.body.appendChild(feedback);
            
            setTimeout(() => {
                feedback.remove();
            }, 3000);
        }

        function setButtonLoading(button, isLoading) {
            if (isLoading) {
                button.classList.add('btn-loading');
                button.disabled = true;
                button.setAttribute('data-original-text', button.innerHTML);
            } else {
                button.classList.remove('btn-loading');
                button.disabled = false;
                if (button.getAttribute('data-original-text')) {
                    button.innerHTML = button.getAttribute('data-original-text');
                }
            }
        }

        function clearForm() {
            document.getElementById('phoneNumber').value = '';
            document.getElementById('messageText').value = '';
            updateCharCount();
        }

        function loadTemplate() {
            const templates = [
                'Xin chào, đây là tin nhắn mẫu từ hệ thống SMS Gateway.',
                'Cảm ơn bạn đã sử dụng dịch vụ của chúng tôi.',
                'Thông báo: Bạn có một thông điệp quan trọng.',
                'Nhắc nhở: Đừng quên cuộc hẹn của bạn vào ngày mai.'
            ];
            
            const randomTemplate = templates[Math.floor(Math.random() * templates.length)];
            document.getElementById('messageText').value = randomTemplate;
            updateCharCount();
        }

        function updateLastLoadTime() {
            const now = new Date();
            console.log(`Đã tải tin nhắn lúc: ${now.toLocaleString('vi-VN')}`);
        }