#!/usr/bin/env python3
"""
Servidor WebSocket para Jogo da Velha Online
"""
import asyncio
import websocket
import json
import sqlite3
from datetime import datetime
from dataclasses import dataclass, field
from typing import Optional
import uuid

# ============================================================
# MODELOS DE DADOS
# ============================================================

@dataclass
class Player:
    ws: websocket.WebSocketServerProtocol
    symbol: str
    player_id: str
    username: str

@dataclass
class Game:
    game_id: str
    players: list[Player] = field(default_factory=list)
    board: list[str] = field(default_factory=lambda: [''] * 9)
    current_turn: str = 'X'
    winner: Optional[str] = None
    
    def reset_board(self):
        self.board = [''] * 9
        self.current_turn = 'X'
        self.winner = None

# ============================================================
# BANCO DE DADOS
# ============================================================

def init_db():
    """Inicializa o banco de dados SQLite."""
    conn = sqlite3.connect('ranking.db')
    conn.execute("""
        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            elo INTEGER DEFAULT 1000,
            wins INTEGER DEFAULT 0,
            losses INTEGER DEFAULT 0,
            draws INTEGER DEFAULT 0,
            streak INTEGER DEFAULT 0,
            best_streak INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.commit()
    conn.close()
    print("✅ Banco de dados inicializado")

def get_player_stats(username: str) -> dict:
    """Retorna estatísticas do jogador."""
    conn = sqlite3.connect('ranking.db')
    conn.row_factory = sqlite3.Row
    
    row = conn.execute(
        "SELECT * FROM players WHERE username = ?", 
        (username,)
    ).fetchone()
    
    if row:
        stats = dict(row)
    else:
        stats = {
            'elo': 1000,
            'wins': 0,
            'losses': 0,
            'draws': 0,
            'streak': 0,
            'best_streak': 0
        }
    
    conn.close()
    return stats

def update_player_stats(username: str, result: str):
    """Atualiza estatísticas após jogo."""
    conn = sqlite3.connect('ranking.db')
    
    conn.execute(
        "INSERT OR IGNORE INTO players (username) VALUES (?)",
        (username,)
    )
    
    if result == 'win':
        conn.execute("""
            UPDATE players SET 
                wins = wins + 1,
                elo = elo + 16,
                streak = streak + 1,
                best_streak = MAX(best_streak, streak + 1)
            WHERE username = ?
        """, (username,))
    elif result == 'loss':
        conn.execute("""
            UPDATE players SET 
                losses = losses + 1,
                elo = MAX(0, elo - 16),
                streak = 0
            WHERE username = ?
        """, (username,))
    else:
        conn.execute("""
            UPDATE players SET 
                draws = draws + 1,
                streak = 0
            WHERE username = ?
        """, (username,))
    
    conn.commit()
    conn.close()

def get_leaderboard(limit: int = 10) -> list:
    """Retorna top jogadores."""
    conn = sqlite3.connect('ranking.db')
    conn.row_factory = sqlite3.Row
    
    rows = conn.execute(
        "SELECT username, elo, wins, losses, draws FROM players ORDER BY elo DESC LIMIT ?",
        (limit,)
    ).fetchall()
    
    conn.close()
    return [dict(row) for row in rows]

# ============================================================
# CONTROLE DO JOGO
# ============================================================

games: dict[str, Game] = {}
waiting_player: Optional[Player] = None
connected_players: dict[str, Player] = {}

WINNING_COMBOS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
]

async def send_json(ws, data):
    """Envia JSON via WebSocket."""
    try:
        await ws.send(json.dumps(data))
    except websocket.exceptions.ConnectionClosed:
        pass

async def broadcast_to_game(game: Game, message: dict):
    """Envia mensagem para todos os jogadores do jogo."""
    for player in game.players:
        await send_json(player.ws, message)

def check_winner(board) -> Optional[str]:
    """Verifica se há vencedor."""
    for combo in WINNING_COMBOS:
        a, b, c = combo
        if board[a] and board[a] == board[b] == board[c]:
            return board[a]
    if all(cell != '' for cell in board):
        return 'draw'
    return None

def get_game_state(game: Game, player: Player) -> dict:
    """Retorna estado do jogo."""
    return {
        'type': 'game_state',
        'game_id': game.game_id,
        'board': game.board,
        'current_turn': game.current_turn,
        'winner': game.winner,
        'status': 'playing' if game.winner is None else 'finished'
    }

async def create_or_join_game(player: Player):
    """Cria novo jogo ou junta jogador existente."""
    global waiting_player
    
    if waiting_player and waiting_player.ws.open:
        game_id = str(uuid.uuid4())[:8]
        game = Game(
            game_id=game_id,
            players=[waiting_player, player]
        )
        games[game_id] = game
        
        for p in game.players:
            await send_json(p.ws, {
                'type': 'game_created',
                'game_id': game_id,
                'symbol': p.symbol,
                'message': f'🎮 Jogo #{game_id} criado! Você é {p.symbol}'
            })
            await send_json(p.ws, get_game_state(game, p))
        
        waiting_player = None
        print(f"✅ Jogo {game_id} criado")
    else:
        waiting_player = player
        await send_json(player.ws, {
            'type': 'waiting',
            'message': '⏳ Procurando oponente...'
        })

async def handle_move(game: Game, player: Player, position: int):
    """Processa jogada do jogador."""
    if game.winner:
        return
    
    if game.current_turn != player.symbol:
        await send_json(player.ws, {
            'type': 'error',
            'message': 'Não é sua vez!'
        })
        return
    
    if position < 0 or position > 8 or game.board[position] != '':
        await send_json(player.ws, {
            'type': 'error',
            'message': 'Jogada inválida!'
        })
        return
    
    game.board[position] = player.symbol
    game.winner = check_winner(game.board)
    
    if game.winner:
        for p in game.players:
            if game.winner == 'draw':
                update_player_stats(p.username, 'draw')
            elif p.symbol == game.winner:
                update_player_stats(p.username, 'win')
            else:
                update_player_stats(p.username, 'loss')
    
    game.current_turn = 'O' if game.current_turn == 'X' else 'X'
    
    for p in game.players:
        state = get_game_state(game, p)
        await send_json(p.ws, state)
    
    leaderboard = get_leaderboard()
    for p in game.players:
        await send_json(p.ws, {
            'type': 'leaderboard',
            'players': leaderboard
        })

async def handle_disconnect(player: Player):
    """Lida com desconexão do jogador."""
    global waiting_player
    
    if waiting_player and waiting_player.player_id == player.player_id:
        waiting_player = None
    
    for game_id, game in list(games.items()):
        if player in game.players:
            for p in game.players:
                if p != player:
                    await send_json(p.ws, {
                        'type': 'player_disconnected',
                        'message': 'Oponente desconectou'
                    })
            del games[game_id]
            break

# ============================================================
# HANDLER PRINCIPAL
# ============================================================

async def handler(websocket):
    """Handler principal de conexões WebSocket."""
    player = None
    
    try:
        async for message in websocket:
            data = json.loads(message)
            
            if data['type'] == 'register':
                player_id = str(uuid.uuid4())[:8]
                player = Player(
                    ws=websocket,
                    symbol='X',
                    player_id=player_id,
                    username=data['username']
                )
                connected_players[player_id] = player
                
                stats = get_player_stats(data['username'])
                
                await send_json(websocket, {
                    'type': 'registered',
                    'username': data['username'],
                    'player_id': player_id,
                    'stats': stats
                })
                
                print(f"👤 {data['username']} conectado")
            
            elif data['type'] == 'find_game' and player:
                await create_or_join_game(player)
            
            elif data['type'] == 'make_move' and player:
                game = games.get(data['game_id'])
                if game:
                    await handle_move(game, player, data['position'])
    
    except websocket.exceptions.ConnectionClosed:
        pass
    finally:
        if player:
            await handle_disconnect(player)
            connected_players.pop(player.player_id, None)
            print(f"👋 {player.username} desconectado")

# ============================================================
# SERVIDOR
# ============================================================

async def main():
    """Inicia o servidor WebSocket."""
    init_db()
    
    print("🚀 Servidor WebSocket em ws://localhost:8765")
    print("📊 Acesse http://localhost:8765 para jogar")
    
    async with websocket.serve(handler, "0.0.0.0", 8765):
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Servidor encerrado")
