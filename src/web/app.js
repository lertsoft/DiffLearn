/**
 * DiffLearn Web UI - Client-side JavaScript
 */

// API endpoint
const API_URL = '';

// State
let currentView = 'local';
let currentDiff = null;
let currentCommit = null;
let commits = [];

// DOM Elements
const elements = {
    llmStatus: document.getElementById('llmStatus'),
    refreshBtn: document.getElementById('refreshBtn'),
    commitList: document.getElementById('commitList'),
    diffHeader: document.getElementById('diffHeader'),
    diffStats: document.getElementById('diffStats'),
    diffContent: document.getElementById('diffContent'),
    quickActions: document.getElementById('quickActions'),
    explainBtn: document.getElementById('explainBtn'),
    reviewBtn: document.getElementById('reviewBtn'),
    summaryBtn: document.getElementById('summaryBtn'),
    chatPanel: document.getElementById('chatPanel'),
    chatMessages: document.getElementById('chatMessages'),
    chatForm: document.getElementById('chatForm'),
    chatInput: document.getElementById('chatInput'),
    sendBtn: document.getElementById('sendBtn'),
    clearChatBtn: document.getElementById('clearChatBtn'),
    viewBtns: document.querySelectorAll('.view-btn'),
};

// ============================================
// API Functions
// ============================================

async function fetchJSON(url, options = {}) {
    try {
        const response = await fetch(API_URL + url, {
            headers: { 'Content-Type': 'application/json' },
            ...options,
        });
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        return { success: false, error: error.message };
    }
}

async function checkLLMStatus() {
    const result = await fetchJSON('/');
    const statusDot = elements.llmStatus.querySelector('.status-dot');
    const statusText = elements.llmStatus.querySelector('.status-text');

    if (result.llmAvailable) {
        statusDot.classList.add('ready');
        statusText.textContent = `AI Ready (${result.llmProvider})`;
    } else if (result.status === 'running') {
        statusDot.classList.remove('ready', 'error');
        statusText.textContent = 'No LLM configured';
    } else {
        statusDot.classList.add('error');
        statusText.textContent = 'API Error';
    }
}

async function fetchLocalDiff(staged = false) {
    const url = staged ? '/diff/local?staged=true' : '/diff/local';
    return await fetchJSON(url);
}

async function fetchCommitDiff(sha) {
    return await fetchJSON(`/diff/commit/${sha}`);
}

async function fetchHistory(limit = 20) {
    return await fetchJSON(`/history?limit=${limit}`);
}

async function askQuestion(question, staged = false) {
    return await fetchJSON('/ask', {
        method: 'POST',
        body: JSON.stringify({ question, staged }),
    });
}

async function explainDiff(staged = false) {
    return await fetchJSON('/explain', {
        method: 'POST',
        body: JSON.stringify({ staged }),
    });
}

async function reviewDiff(staged = false) {
    return await fetchJSON('/review', {
        method: 'POST',
        body: JSON.stringify({ staged }),
    });
}

async function summarizeDiff(staged = false) {
    return await fetchJSON('/summary', {
        method: 'POST',
        body: JSON.stringify({ staged }),
    });
}

// ============================================
// Rendering Functions
// ============================================

function renderCommitList() {
    if (currentView === 'history') {
        renderHistoryList();
    } else {
        renderLocalChangesItem();
    }
}

async function renderLocalChangesItem() {
    const staged = currentView === 'staged';
    const label = staged ? 'Staged Changes' : 'Local Changes';

    elements.commitList.innerHTML = `
    <div class="commit-item local-changes-item active" data-type="local" data-staged="${staged}">
      <div class="commit-hash">📁 Working Directory</div>
      <div class="commit-message">${label}</div>
      <div class="commit-meta">
        <span>Click to view</span>
      </div>
    </div>
  `;

    // Auto-load local changes
    await loadLocalDiff(staged);
}

async function renderHistoryList() {
    elements.commitList.innerHTML = '<div class="loading">Loading commits...</div>';

    const result = await fetchHistory(30);

    if (!result.success || !result.data || result.data.length === 0) {
        elements.commitList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <p>No commits found</p>
      </div>
    `;
        return;
    }

    commits = result.data;

    elements.commitList.innerHTML = commits.map((commit, index) => `
    <div class="commit-item ${index === 0 ? 'active' : ''}" data-type="commit" data-sha="${commit.hash}">
      <div class="commit-hash">${commit.hash.slice(0, 7)}</div>
      <div class="commit-message">${escapeHtml(commit.message.split('\n')[0])}</div>
      <div class="commit-meta">
        <span>${formatDate(commit.date)}</span>
        <span>${escapeHtml(commit.author)}</span>
      </div>
    </div>
  `).join('');

    // Auto-load first commit
    if (commits.length > 0) {
        await loadCommitDiff(commits[0].hash);
    }
}

async function loadLocalDiff(staged = false) {
    elements.diffContent.innerHTML = '<div class="loading">Loading diff...</div>';

    const result = await fetchLocalDiff(staged);

    if (!result.success) {
        elements.diffContent.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">❌</div>
        <p>Error loading diff: ${result.error}</p>
      </div>
    `;
        return;
    }

    currentDiff = result.data;
    currentCommit = null;

    const label = staged ? 'Staged Changes' : 'Local Changes';
    renderDiff(result.data, label);
}

async function loadCommitDiff(sha) {
    elements.diffContent.innerHTML = '<div class="loading">Loading diff...</div>';

    // Update active state
    document.querySelectorAll('.commit-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`[data-sha="${sha}"]`)?.classList.add('active');

    const result = await fetchCommitDiff(sha);

    if (!result.success) {
        elements.diffContent.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">❌</div>
        <p>Error loading diff: ${result.error}</p>
      </div>
    `;
        return;
    }

    currentDiff = result.data;
    currentCommit = sha;

    const commit = commits.find(c => c.hash === sha);
    const title = commit ? `${sha.slice(0, 7)}: ${commit.message.split('\n')[0]}` : sha.slice(0, 7);
    renderDiff(result.data, title);
}

function renderDiff(data, title) {
    const { summary, files } = data;

    // Update header
    elements.diffHeader.querySelector('h2').textContent = title;
    elements.diffStats.innerHTML = `
    <span class="stat-add">+${summary.additions}</span>
    <span class="stat-del">-${summary.deletions}</span>
    <span>${summary.files} file(s)</span>
  `;

    // No changes
    if (!files || files.length === 0) {
        elements.diffContent.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✨</div>
        <p>No changes</p>
      </div>
    `;
        elements.quickActions.style.display = 'none';
        return;
    }

    // Render files
    elements.diffContent.innerHTML = files.map(file => renderFileDiff(file)).join('');
    elements.quickActions.style.display = 'flex';

    // Add click handlers for hunk headers
    document.querySelectorAll('.hunk-header').forEach(header => {
        header.addEventListener('click', (e) => {
            if (e.target.classList.contains('ask-btn')) {
                const hunkIndex = header.dataset.hunk;
                const fileName = header.dataset.file;
                askAboutHunk(fileName, hunkIndex);
            }
        });
    });
}

function renderFileDiff(file) {
    const status = file.isNew ? 'new' : file.isDeleted ? 'deleted' : file.isRenamed ? 'renamed' : 'modified';
    const statusLabel = file.isNew ? 'NEW' : file.isDeleted ? 'DEL' : file.isRenamed ? 'REN' : 'MOD';

    return `
    <div class="file-diff">
      <div class="file-header">
        <div class="file-name">
          <span class="file-status ${status}">${statusLabel}</span>
          <span>${escapeHtml(file.newFile || file.oldFile)}</span>
        </div>
        <div class="file-stats">
          <span class="stat-add">+${file.additions}</span>
          <span class="stat-del">-${file.deletions}</span>
        </div>
      </div>
      ${file.hunks.map((hunk, idx) => renderHunk(hunk, idx, file.newFile)).join('')}
    </div>
  `;
}

function renderHunk(hunk, index, fileName) {
    return `
    <div class="hunk">
      <div class="hunk-header" data-hunk="${index}" data-file="${escapeHtml(fileName)}">
        ${escapeHtml(hunk.header)}
        <button class="ask-btn">Ask about this</button>
      </div>
      ${hunk.lines.map(line => renderDiffLine(line)).join('')}
    </div>
  `;
}

function renderDiffLine(line) {
    const type = line.type;
    // Map type to CSS class (CSS uses 'del' not 'delete')
    const cssClass = type === 'delete' ? 'del' : type;
    const prefix = type === 'add' ? '+' : type === 'delete' ? '-' : ' ';
    const lineNum = type === 'delete' ? (line.oldLineNumber || '') : (line.newLineNumber || '');

    return `
    <div class="diff-line ${cssClass}">
      <span class="line-num">${lineNum}</span>
      <span class="line-content">${prefix}${escapeHtml(line.content)}</span>
    </div>
  `;
}

// ============================================
// Chat Functions
// ============================================

function addMessage(role, content) {
    const icon = role === 'user' ? '👤' : '🤖';
    const label = role === 'user' ? 'You' : 'DiffLearn';

    // Remove welcome message
    const welcome = elements.chatMessages.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    const messageEl = document.createElement('div');
    messageEl.className = `message ${role}`;
    let renderedContent;
    if (role === 'assistant' && typeof marked !== 'undefined') {
        renderedContent = marked.parse(content);
    } else {
        renderedContent = escapeHtml(content);
    }

    messageEl.innerHTML = `
    <div class="message-header">
      <span>${icon}</span>
      <span>${label}</span>
    </div>
    <div class="message-content">${renderedContent}</div>
  `;

    elements.chatMessages.appendChild(messageEl);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;

    return messageEl;
}

function addLoadingMessage() {
    const messageEl = document.createElement('div');
    messageEl.className = 'message assistant loading-message';
    messageEl.innerHTML = `
    <div class="message-header">
      <span>🤖</span>
      <span>DiffLearn</span>
    </div>
    <div class="message-loading">
      <span></span>
      <span></span>
      <span></span>
    </div>
  `;

    elements.chatMessages.appendChild(messageEl);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;

    return messageEl;
}

function removeLoadingMessage() {
    const loading = elements.chatMessages.querySelector('.loading-message');
    if (loading) loading.remove();
}

async function handleChat(question) {
    if (!question.trim()) return;

    addMessage('user', question);
    elements.chatInput.value = '';
    elements.sendBtn.disabled = true;

    const loadingEl = addLoadingMessage();

    try {
        const staged = currentView === 'staged';
        const result = await askQuestion(question, staged);

        removeLoadingMessage();

        if (result.success && result.data) {
            const answer = result.data.answer || result.data.prompt || 'No response';
            addMessage('assistant', answer);
        } else {
            addMessage('assistant', `Error: ${result.error || 'Unknown error'}`);
        }
    } catch (error) {
        removeLoadingMessage();
        addMessage('assistant', `Error: ${error.message}`);
    }

    elements.sendBtn.disabled = false;
    elements.chatInput.focus();
}

async function askAboutHunk(fileName, hunkIndex) {
    const question = `Please explain the changes in file "${fileName}", specifically the hunk at position ${hunkIndex}. What does this change do?`;
    await handleChat(question);
}

function clearChat() {
    elements.chatMessages.innerHTML = `
    <div class="chat-welcome">
      <p>👋 Ask questions about the selected diff!</p>
      <p class="hint">Try: "What does this change do?" or "Is there a bug here?"</p>
    </div>
  `;
}

// ============================================
// Quick Actions
// ============================================

async function handleQuickAction(action) {
    const staged = currentView === 'staged';
    const btn = elements[`${action}Btn`];
    const originalText = btn.innerHTML;

    const questions = {
        explain: 'Please explain these changes.',
        review: 'Please review these changes for potential issues.',
        summary: 'Please provide a summary of these changes.'
    };

    addMessage('user', questions[action] || `Action: ${action}`);

    btn.disabled = true;
    btn.innerHTML = '<span class="action-icon">⏳</span> Loading...';

    addLoadingMessage();

    try {
        let result;
        switch (action) {
            case 'explain':
                result = await explainDiff(staged);
                break;
            case 'review':
                result = await reviewDiff(staged);
                break;
            case 'summary':
                result = await summarizeDiff(staged);
                break;
        }

        removeLoadingMessage();

        if (result.success && result.data) {
            const content = result.data.explanation || result.data.review || result.data.summary || result.data.prompt || 'No response';
            addMessage('assistant', content);
        } else {
            addMessage('assistant', `Error: ${result.error || 'Unknown error'}`);
        }
    } catch (error) {
        removeLoadingMessage();
        addMessage('assistant', `Error: ${error.message}`);
    }

    btn.disabled = false;
    btn.innerHTML = originalText;
}

// ============================================
// Utility Functions
// ============================================

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

    return date.toLocaleDateString();
}

// ============================================
// Event Handlers
// ============================================

// View selector
elements.viewBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        elements.viewBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentView = btn.dataset.view;
        renderCommitList();
    });
});

// Commit list clicks
elements.commitList.addEventListener('click', async (e) => {
    const item = e.target.closest('.commit-item');
    if (!item) return;

    if (item.dataset.type === 'local') {
        const staged = item.dataset.staged === 'true';
        await loadLocalDiff(staged);
    } else if (item.dataset.type === 'commit') {
        await loadCommitDiff(item.dataset.sha);
    }
});

// Refresh button
elements.refreshBtn.addEventListener('click', () => {
    renderCommitList();
});

// Chat form
elements.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleChat(elements.chatInput.value);
});

// Clear chat
elements.clearChatBtn.addEventListener('click', clearChat);

// Quick actions
elements.explainBtn.addEventListener('click', () => handleQuickAction('explain'));
elements.reviewBtn.addEventListener('click', () => handleQuickAction('review'));
elements.summaryBtn.addEventListener('click', () => handleQuickAction('summary'));

// ============================================
// Mobile Interactions
// ============================================

const sidebar = document.querySelector('.sidebar');
const mobileChatToggle = document.getElementById('mobileChatToggle');
const closeChatBtn = document.getElementById('closeChatBtn');

// Toggle sidebar on mobile (tap header to expand/collapse)
if (sidebar) {
    const sidebarHeader = sidebar.querySelector('.sidebar-header');

    sidebarHeader?.addEventListener('click', (e) => {
        // Don't toggle if clicking the refresh button
        if (e.target.closest('#refreshBtn')) return;

        if (window.innerWidth <= 700) {
            sidebar.classList.toggle('expanded');
        }
    });

    // Collapse sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 700 &&
            !sidebar.contains(e.target) &&
            sidebar.classList.contains('expanded')) {
            sidebar.classList.remove('expanded');
        }
    });
}

// Mobile chat toggle button
if (mobileChatToggle) {
    mobileChatToggle.addEventListener('click', () => {
        elements.chatPanel.classList.add('open');
        elements.chatInput.focus();
    });
}

// Close chat button
if (closeChatBtn) {
    closeChatBtn.addEventListener('click', () => {
        elements.chatPanel.classList.remove('open');
    });
}

// Close chat panel when clicking outside on mobile
document.addEventListener('click', (e) => {
    if (window.innerWidth <= 900) {
        const chatPanel = elements.chatPanel;
        const toggle = mobileChatToggle;

        if (chatPanel.classList.contains('open') &&
            !chatPanel.contains(e.target) &&
            !toggle?.contains(e.target)) {
            chatPanel.classList.remove('open');
        }
    }
});

// Handle window resize
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        // Reset mobile states when resizing to desktop
        if (window.innerWidth > 900) {
            elements.chatPanel.classList.remove('open');
        }
        if (window.innerWidth > 700) {
            sidebar?.classList.remove('expanded');
        }
    }, 100);
});

// ============================================
// Initialize
// ============================================

async function init() {
    await checkLLMStatus();
    await renderCommitList();
}

init();

