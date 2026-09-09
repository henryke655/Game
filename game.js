class TicTacToeOnline {
    constructor() {
        // Estado do jogo
        this.ws = null;
        this.username = null;
        this.playerId = null;
        this.gameId = null;
        this.mySymbol = null;
        this.board = Array(9).fill('');
        this.currentTurn = 'X';
        this.gameActive = false;
        this.inQueue = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;

        // Cache de elementos DOM
        this.elements = {};

        // Inicializar
        this.init();
    }

    // ─── Inicialização ──────────────────────────────────────
    init() {
        this.cacheElements();
        this.bindEvents();
        this.connect();
    }

    cacheElements() {
        this.elements = {
            loginModal: document.getElementById('login-modal'),
            usernameInput: document.getElementById('username-input'),
            startBtn: document.getElementById('start-btn'),
            gameArea: document.getElementById('game-area'),
            welcomeUser: document.getElementById('welcome-user'),
            logoutBtn: document.getElementById('logout-btn'),
            status: document.getElementById('status'),
            board: document.getElementById('board'),
            cells: document.querySelectorAll('.cell'),
            joinBtn: document.getElementById('join-btn'),
            rematchBtn: document.getElementById('rematch-btn'),
            leaveBtn: document.getElementById('leave-btn'),
            rankToggle: document.getElementById('rank-toggle'),
            rankingPanel: document.getElementById('ranking-panel'),
            closeRanking: document.getElementById('close-ranking'),
            rankingList: document.getElementById('ranking-list'),
            rankingStats: document.getElementById('ranking-stats'),
            connectionStatus: document.getElementById('connection-status'),
            toastContainer: document.getElementById('toast-container'),
            myRank: document.getElementById('my-rank'),
            myElo: document.getElementById('my-elo'),
            myWins: document.getElementById('my-wins'),
            myStreak: document.getElementById('my-streak'),
        };
    }

    bindEvents() {
        // Login
        this.elements.startBtn.addEventListener('click', () => this.login());
        this.elements.usernameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.login();
        });

        // Logout
        this.elements.logoutBtn.addEventListener('click', () => this.logout());

        // Jogo
        this.elements.cells.forEach(cell => {
            cell.addEventListener('click', () => this.handleClick(cell));
        });

        this.elements.joinBtn.addEventListener('click', () => this.joinQueue());
        this.elements.rematchBtn.addEventListener('click', () => this.requestRematch());
        this.elements.leaveBtn.addEventListener('click', () => this.leaveGame());

        // Ranking
        this.elements.rankToggle.addEventListener('click', () => this.showRanking());
        this.elements.closeRanking.addEventListener('click', () => this.hideRanking());

        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => this.loadRanking(tab.dataset.sort));
        });

        // Reconexão quando volta à aba
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
                this.connect();
            }
        });
    }

    // ─── Conexão WebSocket ──────────────────────────────────
    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
            return;
        }

        this.updateConnectionStatus('connecting');
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${location.hostname}:8765`;

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('✅ WebSocket conectado');
                this.reconnectAttempts = 0;
                this.updateConnectionStatus('online');

                if (this.username) {
                    this.send({ type: 'set_username', username: this.username });
                }
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (e) {
                    console.error('Erro ao parsear mensagem:', e);
                }
            };

            this.ws.onclose = () => {
                console.log('❌ WebSocket desconectado');
                this.updateConnectionStatus('offline');
                this.scheduleReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('Erro no WebSocket:', error);
                this.updateConnectionStatus('offline');
            };
        } catch (e) {
            console.error('Erro ao criar WebSocket:', e);
            this.updateConnectionStatus('offline');
            this.scheduleReconnect();
        }
    }

    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
            setTimeout(() => this.connect(), delay);
        }
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    updateConnectionStatus(status) {
        const dot = this.elements.connectionStatus.querySelector('.dot');
        const text = this.elements.connectionStatus.querySelector('span:last-child');

        dot.className = `dot ${status}`;
        const statusText = {
            online: 'Conectado',
            offline: 'Desconectado',
            connecting: 'Conectando...'
        };
        text.textContent = statusText[status] || status;
    }

    // ─── Login/Logout ───────────────────────────────────────
    login() {
        const username = this.elements.usernameInput.value.trim();

        if (username.length < 2) {
            this.elements.usernameInput.style.borderColor = 'var(--danger)';
            this.showToast('Nome deve ter pelo menos 2 caracteres', 'error');
            return;
        }

        this.username = localStorage.setItem('ttt_username', username);
        this.username = username;
        this.send({ type: 'set_username', username });

        this.elements.loginModal.classList.add('hidden');
        this.elements.gameArea.style.display = 'block';
        this.elements.rankToggle.style.display = 'block';
        this.elements.welcomeUser.textContent = username;

        this.showToast(`Bem-vindo, ${username}!`, 'success');
    }

    logout() {
        this.leaveGame();
        this.username = null;
        this.gameId = null;
        this.mySymbol = null;
        this.gameActive = false;

        this.elements.loginModal.classList.remove('hidden');
        this.elements.gameArea.style.display = 'none';
        this.elements.rankToggle.style.display = 'none';
        this.elements.usernameInput.value = '';

        localStorage.removeItem('ttt_username');
    }

    autoLogin() {
        const saved = localStorage.getItem('ttt_username');
        if (saved && saved.length >= 2) {
            this.elements.usernameInput.value = saved;
            this.login();
        }
    }

    // ─── Handler de Mensagens ───────────────────────────────
    handleMessage(data) {
        switch (data.type) {
            case 'connected':
                this.playerId = data.player_id;
                break;

            case 'profile_loaded':
                this.updateProfile(data.profile);
                break;

            case 'waiting':
                this.inQueue = true;
                this.setStatus(data.message);
                this.elements.joinBtn.disabled = true;
                this.elements.joinBtn.innerHTML = '⏳ Buscando...';
                break;

            case 'game_created':
                this.gameId = data.game_id;
                this.mySymbol = data.symbol;
                this.gameActive = true;
                this.inQueue = false;
                this.showToast(data.message, 'success');
                this.elements.joinBtn.classList.add('hidden');
                this.elements.rematchBtn.style.display = 'none';
                this.elements.leaveBtn.style.display = 'inline-flex';
                break;

            case 'game_state':
                this.board = data.board;
                this.currentTurn = data.current_turn;
                this.updateBoard();
                this.updateTurnStatus(data);
                break;

            case 'game_over':
                this.gameActive = false;
                this.board = data.board;
                this.updateBoard();
                this.setStatus(data.message);

                if (data.winner === 'draw') {
                    this.showToast('🤝 Empate!', 'info');
                } else if (data.winner === this.mySymbol) {
                    this.showToast('🎉 Você venceu!', 'success');
                    this.createConfetti();
                } else {
                    this.showToast('😔 Você perdeu', 'error');
                }

                // Atualizar stats
                if (data.player_stats && data.player_stats[this.mySymbol]) {
                    this.updateProfile(data.player_stats[this.mySymbol]);
                }

                this.elements.joinBtn.classList.add('hidden');
                this.elements.rematchBtn.style.display = 'inline-flex';
                this.elements.leaveBtn.style.display = 'inline-flex';

                // Atualizar ranking
                const activeTab = document.querySelector('.tab.active');
                if (activeTab) {
                    this.loadRanking(activeTab.dataset.sort);
                }
                break;

            case 'new_round':
                this.board = Array(9).fill('');
                this.gameActive = true;
                this.updateBoard();
                this.setStatus(data.message);
                this.showToast('🔄 Nova rodada!', 'info');
                this.elements.rematchBtn.style.display = 'none';
                this.elements.joinBtn.classList.add('hidden');
                break;

            case 'opponent_disconnected':
                this.gameActive = false;
                this.setStatus(data.message);
                this.showToast('❌ Oponente saiu da partida', 'warning');
                this.elements.rematchBtn.style.display = 'none';
                this.elements.joinBtn.classList.remove('hidden');
                this.elements.leaveBtn.style.display = 'none';
                break;

            case 'leaderboard':
                this.renderLeaderboard(data.data, data.sort_by);
                break;

            case 'system_stats':
                this.renderSystemStats(data.data);
                break;

            case 'player_stats':
                if (data.data) {
                    this.updateProfile(data.data);
                }
                break;

            case 'error':
                this.showToast(data.message, 'error');
                this.inQueue = false;
                this.elements.joinBtn.disabled = false;
                this.elements.joinBtn.innerHTML = '🎮 Procurar Oponente';
                break;
        }
    }

    // ─── Atualização de UI ──────────────────────────────────
    setStatus(message) {
        this.elements.status.innerHTML = message;
    }

    updateProfile(profile) {
        if (!profile) return;

        this.elements.myRank.textContent = profile.rank || '-';
        this.elements.myElo.textContent = profile.elo_rating || 1000;
        this.elements.myWins.textContent = profile.wins || 0;
        this.elements.myStreak.textContent = profile.win_streak || profile.best_streak || 0;
    }

    updateBoard() {
        this.elements.cells.forEach((cell, index) => {
            const value = this.board[index];
            cell.textContent = value;
            cell.className = 'cell';

            if (value) {
                cell.classList.add(value.toLowerCase());
            }

            // Desabilitar células quando não for a vez do jogador
            if (!this.gameActive || value || this.currentTurn !== this.mySymbol || this.inQueue) {
                cell.classList.add('disabled');
            }
        });
    }

    updateTurnStatus(data) {
        if (this.currentTurn === this.mySymbol) {
            this.setStatus(`🎯 <strong>Sua vez!</strong> (Você é <span class="text-${this.mySymbol.toLowerCase()}">${this.mySymbol}</span>)`);
        } else {
            const opponent = data.opponent || 'Oponente';
            this.setStatus(`⏳ Vez de <strong>${opponent}</strong>`);
        }
    }

    // ─── Ações do Jogo ──────────────────────────────────────
    handleClick(cell) {
        if (!this.gameActive || this.currentTurn !== this.mySymbol) {
            return;
        }

        const index = parseInt(cell.dataset.index);
        if (this.board[index] !== '') {
            return;
        }

        this.send({
            type: 'move',
            game_id: this.gameId,
            index: index
        });
    }

    joinQueue() {
        if (this.inQueue) return;

        this.send({ type: 'join_queue' });
    }

    requestRematch() {
        if (!this.gameId) {
            // Procurar novo jogo
            this.joinQueue();
            return;
        }

        this.send({
            type: 'rematch',
            game_id: this.gameId
        });
    }

    leaveGame() {
        if (this.gameId) {
            this.send({
                type: 'leave_game',
                game_id: this.gameId
            });
        }

        this.gameId = null;
        this.mySymbol = null;
        this.gameActive = false;
        this.inQueue = false;
        this.board = Array(9).fill('');
        this.updateBoard();

        this.setStatus('Pronto para jogar');
        this.elements.joinBtn.classList.remove('hidden');
        this.elements.joinBtn.disabled = false;
        this.elements.joinBtn.innerHTML = '🎮 Procurar Oponente';
        this.elements.rematchBtn.style.display = 'none';
        this.elements.leaveBtn.style.display = 'none';
    }

    // ─── Ranking ────────────────────────────────────────────
    showRanking() {
        this.elements.rankingPanel.classList.add('active');
        const activeTab = document.querySelector('.tab.active');
        this.loadRanking(activeTab?.dataset.sort || 'elo_rating');
        this.send({ type: 'system_stats' });
    }

    hideRanking() {
        this.elements.rankingPanel.classList.remove('active');
    }

    loadRanking(sortBy) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelector(`[data-sort="${sortBy}"]`)?.classList.add('active');

        this.send({
            type: 'get_leaderboard',
            sort_by: sortBy,
            limit: 50
        });
    }

    renderLeaderboard(data, sortBy) {
        if (!data || !data.length) {
            this.elements.rankingList.innerHTML = `
                <div class="empty-state">
                    <p>🏆 Nenhum jogador ainda</p>
                    <p>Seja o primeiro a jogar!</p>
                </div>
            `;
            return;
        }

        this.elements.rankingList.innerHTML = data.map((player, index) => {
            const position = index + 1;
            const rankClass = position === 1 ? 'gold' : position === 2 ? 'silver' : position === 3 ? 'bronze' : '';
            const topClass = position <= 3 ? `top-${position}` : '';
            const isMe = player.username === this.username ? 'me' : '';

            return `
                <div class="rank-item ${topClass} ${isMe}">
                    <div class="rank-position ${rankClass}">${position}</div>
                    <div class="rank-info">
                        <div class="rank-username">${this.escapeHtml(player.username)}</div>
                        <div class="rank-details">
                            <span class="rank-stat">🎯 ${player.wins}V</span>
                            <span class="rank-stat">💀 ${player.losses}D</span>
                            <span class="rank-stat">🤝 ${player.draws}E</span>
                            <span class="rank-stat">📊 ${player.win_rate}%</span>
                            <span class="rank-stat">🔥 ${player.best_streak}</span>
                        </div>
                    </div>
                    <div class="rank-elo">${player.elo_rating}</div>
                </div>
            `;
        }).join('');
    }

    renderSystemStats(stats) {
        if (!stats) return;

        this.elements.rankingStats.innerHTML = `
            👥 ${stats.active_players || 0} jogadores ativos · 
            🎮 ${stats.total_matches || 0} partidas · 
            📅 ${stats.matches_today || 0} hoje
        `;
    }

    // ─── Efeitos Visuais ────────────────────────────────────
    createConfetti() {
        const colors = ['#ffd93d', '#ff6b6b', '#00d4ff', '#00ff88', '#667eea', '#ff9ff3'];

        for (let i = 0; i < 50; i++) {
            setTimeout(() => {
                const confetti = document.createElement('div');
                confetti.className = 'confetti';
                confetti.style.left = Math.random() * 100 + 'vw';
                confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
                confetti.style.width = (Math.random() * 10 + 5) + 'px';
                confetti.style.height = (Math.random() * 10 + 5) + 'px';
                confetti.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
                document.body.appendChild(confetti);

                setTimeout(() => confetti.remove(), 2000);
            }, i * 30);
        }
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        this.elements.toastContainer.appendChild(toast);

        setTimeout(() => toast.remove(), 3000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// ─── Iniciar Aplicação ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    window.game = new TicTacToeOnline();
    window.game.autoLogin();
});
