"""🚀 Servidor WebSocket - Jogo da Velha Online"""

import asyncio
import websocket
import json
from dataclasses import dataclass, field
from typing import Optional
import uuid
import time

from database import (
    init_db, get_or_create_player, record_match,
    get_leaderboard, get_player_stats, get_system_stats
)


# ─── Modelos de Dados ─────────────────────────────────────────
@dataclass
class Player:
    ws: websocket.WebSocketServerProtocol
    symbol: str
    player_id: str
    username: str = ""


@dataclass
class Game:
    game_id: str
    players: list[Player] = field(default_factory=list)
    board: list[str] = field(default_factory=lambda: [''] * 9)
    current_turn: str = 'X'
    winner: Optional[str] = None
    start_time: float = 0.0

    def is_full(self) -> bool:
        return len(self.players) >= 2

    def reset_board(self):
        self.board = [''] * 9
        self.current_turn = 'X'
        self.winner = None
        self.start_time = time.time()


# ─── Estado Global ────────────────────────────────────────────
games: dict[str, Game] = {}
waiting_player: Optional[Player] = None

WINNING_COMBOS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
]


# ─── Utilitários ──────────────────────────────────────────────
async def send_json(ws, data):
    """Envia JSON via WebSocket."""
    if ws.open:
        await ws.send(json.dumps(data))


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


# ─── Lógica do Jogo ───────────────────────────────────────────
async def create_or_join_game(player: Player):
    """Cria um novo jogo ou adiciona à fila."""
    global waiting_player

    if waiting_player and waiting_player.ws.open and waiting_player.username:
        game_id = str(uuid.uuid4())[:8]
        game = Game(
            game_id=game_id,
            players=[waiting_player, player],
            start_time=time.time()
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
        print(f"✅ Jogo {game_id}: {game.players[0].username} vs {game.players[1].username}")
    else:
        waiting_player = player
        await send_json(player.ws, {
            'type': 'waiting',
            'message': '⏳ Procurando oponente...'
        })


async def handle_move(game: Game, player: Player, index: int):
    """Processa uma jogada."""
    if game.winner:
        return
    if player.symbol != game.current_turn:
        return
    if index < 0 or index > 8 or game.board[index]:
        return

    game.board[index] = player.symbol
    game.current_turn = 'O' if game.current_turn == 'X' else 'X'

    result = check_winner(game.board)

    if result:
        game.winner = result
        duration = int(time.time() - game.start_time)

        player_x = game.players[0].username
        player_o = game.players[1].username
        winner = None if result == 'draw' else result

        record_match(player_x, player_o, winner, duration)

        stats_x = get_player_stats(player_x)
        stats_o = get_player_stats(player_o)

        if result == 'draw':
            message = '🤝 Empate!'
        else:
            winner_name = game.players[0].username if result == 'X' else game.players[1].username
            message = f'🎉 {winner_name} venceu!'

        await broadcast_to_game(game, {
            'type': 'game_over',
            'winner': result,
            'message': message,
            'board': game.board,
            'duration': duration,
            'player_stats': {
                'X': {
                    'username': player_x,
                    'rank': stats_x['rank'] if stats_x else None,
                    'elo_rating': stats_x['elo_rating'] if stats_x else 1000,
                    'wins': stats_x['wins'] if stats_x else 0,
                    'win_streak': stats_x['win_streak'] if stats_x else 0
                },
                'O': {
                    'username': player_o,
                    'rank': stats_o['rank'] if stats_o else None,
                    'elo_rating': stats_o['elo_rating'] if stats_o else 1000,
                    'wins': stats_o['wins'] if stats_o else 0,
                    'win_streak': stats_o['win_streak'] if stats_o else 0
                }
            }
        })
    else:
        for p in game.players:
            await send_json(p.ws, get_game_state(game, p))


def get_game_state(game: Game, player: Player) -> dict:
    """Retorna o estado atual do jogo para um jogador."""
    opponent = next((p for p in game.players if p != player), None)
    return {
        'type': 'game_state',
        'game_id': game.game_id,
        'board': game.board,
        'current_turn': game.current_turn,
        'my_symbol': player.symbol,
        'opponent': opponent.username if opponent else None,
        'winner': game.winner
    }


# ─── Handler WebSocket ────────────────────────────────────────
async def handler(ws):
    """Handler principal do WebSocket."""
    global waiting_player

    player_id = str(uuid.uuid4())[:8]
    player = Player(ws=ws, symbol='X', player_id=player_id)

    print(f"🔌 {player_id} conectou")

    try:
        await send_json(ws, {
            'type': 'connected',
            'player_id': player_id,
            'message': '✅ Conectado ao servidor!'
        })

        async for message in ws:
            try:
                data = json.loads(message)
                msg_type = data.get('type')

                if msg_type == 'set_username':
                    username = data.get('username', f'player_{player_id[:4]}')
                    player.username = username
                    profile = get_or_create_player(username)
                    await send_json(ws, {
                        'type': 'profile_loaded',
                        'profile': profile
                    })

                elif msg_type == 'join_queue':
                    if player.username:
                        await create_or_join_game(player)

                elif msg_type == 'move':
                    game_id = data.get('game_id')
                    index = int(data.get('index', -1))
                    if game_id in games:
                        await handle_move(games[game_id], player, index)

                elif msg_type == 'get_leaderboard':
                    sort_by = data.get('sort_by', 'elo_rating')
                    limit = data.get('limit', 50)
                    leaderboard = get_leaderboard(limit, sort_by)
                    await send_json(ws, {
                        'type': 'leaderboard',
                        'data': leaderboard,
                        'sort_by': sort_by
                    })

                elif msg_type == 'system_stats':
                    stats = get_system_stats()
                    await send_json(ws, {
                        'type': 'system_stats',
                        'data': stats
                    })

                elif msg_type == 'rematch':
                    game_id = data.get('game_id')
                    if game_id in games:
                        game = games[game_id]
                        game.reset_board()
                        for p in game.players:
                            await send_json(p.ws, {'type': 'new_round', 'message': '🔄 Nova rodada!'})
                            await send_json(p.ws, get_game_state(game, p))

                elif msg_type == 'leave_game':
                    game_id = data.get('game_id')
                    if game_id in games:
                        game = games[game_id]
                        if player in game.players:
                            opponent = next((p for p in game.players if p != player), None)
                            if opponent and opponent.ws.open:
                                await send_json(opponent.ws, {
                                    'type': 'opponent_disconnected',
                                    'message': '❌ Oponente saiu da partida'
                                })
                            del games[game_id]

                elif msg_type == 'get_stats':
                    target = data.get('username', player.username)
                    stats = get_player_stats(target)
                    await send_json(ws, {
                        'type': 'player_stats',
                        'data': stats
                    })

            except json.JSONDecodeError:
                pass
            except Exception as e:
                print(f"Erro ao processar mensagem: {e}")

    except websocket.ConnectionClosed:
        print(f"🔌 {player_id} ({player.username}) desconectou")
    finally:
        # Limpar da fila de espera
        if waiting_player and waiting_player.player_id == player.player_id:
            waiting_player = None

        # Limpar de jogos ativos
        for game_id, game in list(games.items()):
            if player in game.players:
                opponent = next((p for p in game.players if p != player), None)
                if opponent and opponent.ws.open:
                    await send_json(opponent.ws, {
                        'type': 'opponent_disconnected',
                        'message': '❌ Oponente desconectou'
                    })
                del games[game_id]
                print(f"🗑️ Jogo {game_id} removido")


# ─── Servidor HTTP para arquivos estáticos ────────────────────
class StaticFileHandler:
    """Serve arquivos estáticos do frontend."""

    def __init__(self, static_dir):
        import os
        self.static_dir = os.path.abspath(static_dir)
        self.mime_types = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon'
        }

    async def __call__(self, path, headers):
        import os

        if path == '/':
            path = '/index.html'

        file_path = os.path.join(self.static_dir, path.lstrip('/'))

        if not os.path.exists(file_path) or not os.path.isfile(file_path):
            # Fallback para index.html (SPA)
            file_path = os.path.join(self.static_dir, 'index.html')

        try:
            with open(file_path, 'rb') as f:
                content = f.read()

            ext = os.path.splitext(file_path)[1]
            content_type = self.mime_types.get(ext, 'application/octet-stream')

            return [200, {'Content-Type': content_type}, content]
        except Exception:
            return [404, {'Content-Type': 'text/plain'}, b'Not Found']


# ─── Main ─────────────────────────────────────────────────────
async def main():
    """Inicia o servidor."""
    import os

    # Inicializar banco de dados
    init_db()

    # Configurar handler para arquivos estáticos
    frontend_dir = os.path.join(os.path.dirname(__file__), '..', 'frontend')
    static_handler = StaticFileHandler(frontend_dir)

    # Criar servidor WebSocket com suporte a HTTP
    async def process_request(path, headers):
        """Processa requisições HTTP (para servir arquivos estáticos)."""
        if path.startswith('/ws'):
            return None  # Deixar o WebSocket lidar

        # Servir arquivos estáticos
        return await static_handler(path, headers)

    print("🚀 Servidor rodando em http://localhost:8765")
    print("📱 Abra no navegador para jogar!")

    async with websocket.serve(
        handler,
        "0.0.0.0",
        8765,
        process_request=process_request,
        ping_interval=20,
        ping_timeout=10
    ):
        await asyncio.Future()  # Rodar para sempre


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Servidor encerrado")
