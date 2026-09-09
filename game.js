// ============================================================
// JOGO DA VELHA - 3 MODOS DE JOGO
// ============================================================

// === CONSTANTES ===
const WINNING_COMBOS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
];

// === ESTADO GLOBAL ===
let gameState = {
    mode: null,
    board: Array(9).fill(''),
    currentPlayer: 'X',
    winner: null,
    scores: { X: 0, O: 0, draws: 0 },
    gameOver: false,
    mySymbol: 'X',
    opponentSymbol: 'O',
    username: null,
    ws: null,
    gameId: null
};

// === ELEMENTOS DOM ===
const $ = id => document.getElementById(id);
const cells = document.querySelectorAll('.cell');

// === INICIALIZAÇÃO ===
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
});

function setupEventListeners() {
    $('solo-btn').addEventListener('click', () => startGame('solo'));
    $('local-btn').addEventListener('click', () => startGame('local'));
    $('online-btn').addEventListener('click', showLoginModal);
    $('start-online-btn').addEventListener('click', connectOnline);
    $('back-btn').addEventListener('click', hideLoginModal);
    $('reset-btn').addEventListener('click', resetGame);
    $('menu-btn').addEventListener('click', backToMenu);
    $('back-menu-btn').addEventListener('click', backToMenu);
    
    cells.forEach(cell => {
        cell.addEventListener('click', handleCellClick);
    });
}

// ============================================================
// CONTROLES DE TELA
// ============================================================

function showModeModal() {
    $('mode-modal').style.display = 'flex';
    $('login-modal').style.display = 'none';
    $('game-area').style.display = 'none';
}

function showLoginModal() {
    $('mode-modal').style.display = 'none';
    $('login-modal').style.display = 'flex';
    $('username-input').focus();
}

function hideLoginModal() {
    $('login-modal').style.display = 'none';
    $('mode-modal').style.display = 'flex';
}

function showGameArea() {
    $('mode-modal').style.display = 'none';
    $('login-modal').style.display = 'none';
    $('game-area').style.display = 'block';
}

function backToMenu() {
    if (gameState.ws) {
        gameState.ws.close();
        gameState.ws = null;
    }
    resetGameState();
    showModeModal();
}

// ============================================================
// CONTROLE DO JOGO
// ============================================================

function startGame(mode) {
    gameState.mode = mode;
    resetGameState();
    
    switch (mode) {
        case 'solo':
            $('game-title').textContent = '🤖 Solo vs IA';
            $('mode-display').textContent = 'Modo: Solo';
            $('online-stats').style.display = 'none';
            $('leaderboard').style.display = 'none';
            gameState.mySymbol = 'X';
            gameState.opponentSymbol = 'O';
            break;
            
        case 'local':
            $('game-title').textContent = '👥 Local';
            $('mode-display').textContent = 'Modo: Local';
            $('online-stats').style.display = 'none';
            $('leaderboard').style.display = 'none';
            gameState.mySymbol = 'X';
            gameState.opponentSymbol = 'O';
            break;
            
        case 'online':
            $('game-title').textContent = '🌐 Online';
            $('mode-display').textContent = 'Modo: Online';
            $('online-stats').style.display = 'flex';
            $('leaderboard').style.display = 'block';
            break;
    }
    
    showGameArea();
    updateDisplay();
}

function resetGameState() {
    gameState.board = Array(9).fill('');
    gameState.currentPlayer = 'X';
    gameState.winner = null;
    gameState.gameOver = false;
    gameState.scores = { X: 0, O: 0, draws: 0 };
    gameState.gameId = null;
    
    cells.forEach(cell => {
        cell.textContent = '';
        cell.className = 'cell';
    });
    
    updateScores();
    updateDisplay();
}

function resetGame() {
    gameState.board = Array(9).fill('');
    gameState.currentPlayer = 'X';
    gameState.winner = null;
    gameState.gameOver = false;
    
    cells.forEach(cell => {
        cell.textContent = '';
        cell.className = 'cell';
    });
    
    updateDisplay();
}

// ============================================================
// LÓGICA DO JOGO
// ============================================================

function handleCellClick(e) {
    const index = parseInt(e.target.dataset.index);
    
    if (gameState.board[index] !== '' || gameState.gameOver) return;
    
    if (gameState.mode === 'online') {
        if (gameState.currentPlayer !== gameState.mySymbol) return;
        sendMove(index);
        return;
    }
    
    makeMove(index, gameState.currentPlayer);
    
    if (gameState.mode === 'solo' && !gameState.gameOver && gameState.currentPlayer === 'O') {
        setTimeout(aiMove, 500);
    }
}

function makeMove(index, player) {
    gameState.board[index] = player;
    
    const cell = cells[index];
    cell.textContent = player;
    cell.classList.add('taken', player.toLowerCase());
    
    const winCombo = checkWin(player);
    if (winCombo) {
        gameState.winner = player;
        gameState.gameOver = true;
        gameState.scores[player]++;
        highlightWin(winCombo);
        updateScores();
        
        if (gameState.mode === 'solo') {
            showToast(player === 'X' ? '🎉 Você venceu!' : '😔 IA venceu!');
        } else {
            showToast(`🎉 ${player} venceu!`);
        }
        createConfetti();
        return;
    }
    
    if (gameState.board.every(cell => cell !== '')) {
        gameState.gameOver = true;
        gameState.scores.draws++;
        updateScores();
        showToast('🤝 Empate!');
        return;
    }
    
    gameState.currentPlayer = gameState.currentPlayer === 'X' ? 'O' : 'X';
    updateDisplay();
}

function checkWin(player) {
    for (const combo of WINNING_COMBOS) {
        const [a, b, c] = combo;
        if (gameState.board[a] === player && 
            gameState.board[b] === player && 
            gameState.board[c] === player) {
            return combo;
        }
    }
    return null;
}

function highlightWin(combo) {
    combo.forEach((index, i) => {
        setTimeout(() => {
            cells[index].classList.add('win');
        }, i * 150);
    });
}

// ============================================================
// IA MÉDIA
// ============================================================

function aiMove() {
    if (gameState.gameOver) return;
    
    const move = getMediumAI();
    makeMove(move, 'O');
}

function getMediumAI() {
    const board = gameState.board;
    
    // 60% jogada ótima, 40% aleatória
    if (Math.random() < 0.6) {
        return getOptimalMove(board);
    } else {
        return getRandomMove(board);
    }
}

function getOptimalMove(board) {
    // 1. Vitória imediata
    const winMove = findWinningMove(board, 'O');
    if (winMove !== null) return winMove;
    
    // 2. Bloquear oponente
    const blockMove = findWinningMove(board, 'X');
    if (blockMove !== null) return blockMove;
    
    // 3. Centro
    if (board[4] === '') return 4;
    
    // 4. Cantos
    const corners = [0, 2, 6, 8].filter(i => board[i] === '');
    if (corners.length > 0) {
        return corners[Math.floor(Math.random() * corners.length)];
    }
    
    // 5. Lados
    const sides = [1, 3, 5, 7].filter(i => board[i] === '');
    if (sides.length > 0) {
        return sides[Math.floor(Math.random() * sides.length)];
    }
    
    return getRandomMove(board);
}

function findWinningMove(board, symbol) {
    for (let i = 0; i < 9; i++) {
        if (board[i] === '') {
            board[i] = symbol;
            const wins = WINNING_COMBOS.some(([a, b, c]) => 
                board[a] === symbol && board[b] === symbol && board[c] === symbol
            );
            board[i] = '';
            if (wins) return i;
        }
    }
    return null;
}

function getRandomMove(board) {
    const available = board.reduce((acc, cell, i) => {
        if (cell === '') acc.push(i);
        return acc;
    }, []);
    return available[Math.floor(Math.random() * available.length)];
}

// ============================================================
// MODO ONLINE (WEBSOCKET)
// ============================================================

function connectOnline() {
    const username = $('username-input').value.trim();
    if (!username) {
        showToast('⚠️ Digite um nome!');
        return;
    }
    
    gameState.username = username;
    
    try {
        const wsUrl = `ws://${window.location.hostname}:8765`;
        gameState.ws = new WebSocket(wsUrl);
        
        gameState.ws.onopen = () => {
            showToast('🔌 Conectado!');
            gameState.ws.send(JSON.stringify({
                type: 'register',
                username: username
            }));
        };
        
        gameState.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleServerMessage(data);
        };
        
        gameState.ws.onerror = () => {
            showToast('❌ Erro de conexão');
        };
        
        gameState.ws.onclose = () => {
            showToast('🔌 Desconectado');
        };
        
        startGame('online');
        
    } catch (e) {
        showToast('❌ Não foi possível conectar ao servidor');
    }
}

function handleServerMessage(data) {
    switch (data.type) {
        case 'registered':
            showToast(`✅ Bem-vindo, ${data.username}!`);
            if (data.stats) {
                $('my-elo').textContent = data.stats.elo || 1000;
                $('my-wins').textContent = data.stats.wins || 0;
                $('my-streak').textContent = data.stats.streak || 0;
            }
            break;
            
        case 'waiting':
            showToast('⏳ Procurando oponente...');
            $('status').innerHTML = '⏳ Procurando oponente...';
            break;
            
        case 'game_created':
            gameState.gameId = data.game_id;
            gameState.mySymbol = data.symbol;
            gameState.opponentSymbol = data.symbol === 'X' ? 'O' : 'X';
            showToast(data.message);
            $('label-x').textContent = data.symbol === 'X' ? `${gameState.username} (X)` : 'Oponente (X)';
            $('label-o').textContent = data.symbol === 'O' ? `${gameState.username} (O)` : 'Oponente (O)';
            break;
            
        case 'game_state':
            gameState.board = data.board;
            gameState.currentPlayer = data.current_turn;
            gameState.winner = data.winner;
            updateBoardFromServer();
            updateDisplay();
            break;
            
        case 'player_disconnected':
            showToast('⚠️ Oponente desconectou');
            $('status').innerHTML = '⚠️ Oponente saiu';
            gameState.gameOver = true;
            break;
            
        case 'leaderboard':
            updateLeaderboard(data.players);
            break;
    }
}

function sendMove(index) {
    if (gameState.ws && gameState.ws.readyState === WebSocket.OPEN) {
        gameState.ws.send(JSON.stringify({
            type: 'make_move',
            game_id: gameState.gameId,
            position: index
        }));
    }
}

function updateBoardFromServer() {
    gameState.board.forEach((value, index) => {
        const cell = cells[index];
        cell.textContent = value;
        cell.className = 'cell';
        if (value) {
            cell.classList.add('taken', value.toLowerCase());
        }
    });
    
    if (gameState.winner) {
        const winCombo = checkWin(gameState.winner);
        if (winCombo) highlightWin(winCombo);
    }
}

function updateLeaderboard(players) {
    const list = $('leaderboard-list');
    list.innerHTML = '';
    
    players.slice(0, 10).forEach((player, index) => {
        const isMe = player.username === gameState.username;
        list.innerHTML += `
            <div class="leaderboard-item ${isMe ? 'me' : ''}">
                <span>${index + 1}. ${player.username}</span>
                <span>ELO: ${player.elo}</span>
            </div>
        `;
    });
}

// ============================================================
// UI HELPERS
// ============================================================

function updateDisplay() {
    if (gameState.gameOver) {
        if (gameState.winner) {
            $('status').innerHTML = `🎉 <span class="player-${gameState.winner.toLowerCase()}">${gameState.winner}</span> venceu!`;
        } else {
            $('status').innerHTML = '🤝 Empate!';
        }
    } else {
        $('status').innerHTML = `Vez do <span class="player-${gameState.currentPlayer.toLowerCase()}">${gameState.currentPlayer}</span>`;
    }
}

function updateScores() {
    $('score-x').textContent = gameState.scores.X;
    $('score-o').textContent = gameState.scores.O;
    $('score-draw').textContent = gameState.scores.draws;
}

function showToast(message) {
    const container = $('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function createConfetti() {
    const colors = ['#ef4444', '#3b82f6', '#22c55e', '#fbbf24', '#8b5cf6'];
    
    for (let i = 0; i < 50; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + 'vw';
        confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.animationDelay = Math.random() * 2 + 's';
        confetti.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
        document.body.appendChild(confetti);
        
        setTimeout(() => confetti.remove(), 3000);
    }
}
