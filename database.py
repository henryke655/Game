"""🗄️ Módulo de Banco de Dados - Ranking Global"""

import sqlite3
import os
from datetime import datetime
from contextlib import contextmanager
from typing import Optional

# ─── Configuração ─────────────────────────────────────────────
DB_PATH = os.getenv("DB_PATH", "ranking.db")


# ─── Conexão ──────────────────────────────────────────────────
@contextmanager
def get_connection():
    """Context manager para conexões SQLite."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ─── Inicialização ────────────────────────────────────────────
def init_db():
    """Cria as tabelas necessárias."""
    with get_connection() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS players (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                username    TEXT UNIQUE NOT NULL,
                created_at  TEXT DEFAULT (datetime('now')),
                last_seen   TEXT DEFAULT (datetime('now'))
            );
            
            CREATE TABLE IF NOT EXISTS matches (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                player_x    TEXT NOT NULL,
                player_o    TEXT NOT NULL,
                winner      TEXT,
                played_at   TEXT DEFAULT (datetime('now')),
                duration    INTEGER DEFAULT 0
            );
            
            CREATE TABLE IF NOT EXISTS scores (
                player_id    INTEGER PRIMARY KEY,
                username     TEXT UNIQUE NOT NULL,
                wins         INTEGER DEFAULT 0,
                losses       INTEGER DEFAULT 0,
                draws        INTEGER DEFAULT 0,
                games_played INTEGER DEFAULT 0,
                win_streak   INTEGER DEFAULT 0,
                best_streak  INTEGER DEFAULT 0,
                elo_rating   INTEGER DEFAULT 1000,
                updated_at   TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (player_id) REFERENCES players(id)
            );
            
            CREATE INDEX IF NOT EXISTS idx_scores_elo ON scores(elo_rating DESC);
            CREATE INDEX IF NOT EXISTS idx_scores_wins ON scores(wins DESC);
        """)
    print("✅ Banco de dados inicializado")


# ─── Operações de Jogador ─────────────────────────────────────
def get_or_create_player(username: str) -> dict:
    """Busca ou cria um jogador."""
    username = username.strip().lower()

    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM players WHERE username = ?",
            (username,)
        ).fetchone()

        if row:
            conn.execute(
                "UPDATE players SET last_seen = datetime('now') WHERE id = ?",
                (row['id'],)
            )
            player_id = row['id']
        else:
            cursor = conn.execute(
                "INSERT INTO players (username) VALUES (?)",
                (username,)
            )
            player_id = cursor.lastrowid
            conn.execute(
                "INSERT INTO scores (player_id, username) VALUES (?, ?)",
                (player_id, username)
            )

        score = conn.execute(
            "SELECT * FROM scores WHERE player_id = ?",
            (player_id,)
        ).fetchone()

        return dict(score) if score else {
            "player_id": player_id,
            "username": username,
            "wins": 0, "losses": 0, "draws": 0,
            "games_played": 0, "win_streak": 0,
            "best_streak": 0, "elo_rating": 1000
        }


# ─── Operações de Partida ─────────────────────────────────────
def record_match(player_x: str, player_o: str, winner: Optional[str],
                 duration: int = 0):
    """Registra uma partida e atualiza o ranking."""
    player_x = player_x.strip().lower()
    player_o = player_o.strip().lower()

    get_or_create_player(player_x)
    get_or_create_player(player_o)

    with get_connection() as conn:
        conn.execute(
            "INSERT INTO matches (player_x, player_o, winner, duration) VALUES (?, ?, ?, ?)",
            (player_x, player_o, winner, duration)
        )

        elo_change = calculate_elo_change(conn, player_x, player_o, winner)
        update_player_stats(conn, player_x, winner, 'X', elo_change['X'])
        update_player_stats(conn, player_o, winner, 'O', elo_change['O'])

    return {"status": "ok", "elo_change": elo_change}


def calculate_elo_change(conn, player_x: str, player_o: str,
                         winner: Optional[str]) -> dict:
    """Calcula a variação de ELO (K=32)."""
    K = 32

    x_row = conn.execute(
        "SELECT elo_rating FROM scores WHERE username = ?", (player_x,)
    ).fetchone()
    o_row = conn.execute(
        "SELECT elo_rating FROM scores WHERE username = ?", (player_o,)
    ).fetchone()

    rating_x = x_row['elo_rating'] if x_row else 1000
    rating_o = o_row['elo_rating'] if o_row else 1000

    expected_x = 1 / (1 + 10 ** ((rating_o - rating_x) / 400))
    expected_o = 1 - expected_x

    if winner == 'X':
        actual_x, actual_o = 1.0, 0.0
    elif winner == 'O':
        actual_x, actual_o = 0.0, 1.0
    else:
        actual_x, actual_o = 0.5, 0.5

    return {
        "X": round(K * (actual_x - expected_x)),
        "O": round(K * (actual_o - expected_o))
    }


def update_player_stats(conn, username: str, winner: Optional[str],
                        symbol: str, elo_change: int):
    """Atualiza as estatísticas de um jogador."""
    is_win = (winner == symbol)
    is_loss = (winner is not None and winner != symbol)
    is_draw = (winner is None)

    conn.execute("""
        UPDATE scores SET
            wins = wins + ?,
            losses = losses + ?,
            draws = draws + ?,
            games_played = games_played + 1,
            win_streak = CASE WHEN ? = 1 THEN win_streak + 1 ELSE 0 END,
            best_streak = CASE 
                WHEN ? = 1 AND win_streak + 1 > best_streak 
                THEN win_streak + 1
                ELSE best_streak 
            END,
            elo_rating = MAX(100, elo_rating + ?),
            updated_at = datetime('now')
        WHERE username = ?
    """, (
        1 if is_win else 0,
        1 if is_loss else 0,
        1 if is_draw else 0,
        1 if is_win else 0,
        1 if is_win else 0,
        elo_change,
        username
    ))


# ─── Consultas de Ranking ─────────────────────────────────────
def get_leaderboard(limit: int = 50, sort_by: str = "elo_rating") -> list:
    """Retorna o ranking global."""
    valid_sorts = {
        "elo_rating": "elo_rating DESC",
        "wins": "wins DESC",
        "win_rate": "CASE WHEN games_played > 0 THEN wins * 100.0 / games_played ELSE 0 END DESC",
        "streak": "best_streak DESC"
    }

    order = valid_sorts.get(sort_by, "elo_rating DESC")

    with get_connection() as conn:
        rows = conn.execute(f"""
            SELECT 
                ROW_NUMBER() OVER (ORDER BY elo_rating DESC) as rank,
                username, elo_rating, wins, losses, draws,
                games_played,
                CASE WHEN games_played > 0 
                    THEN ROUND(wins * 100.0 / games_played, 1)
                    ELSE 0 
                END as win_rate,
                win_streak, best_streak
            FROM scores
            WHERE games_played > 0
            ORDER BY {order}
            LIMIT ?
        """, (limit,)).fetchall()

        return [dict(row) for row in rows]


def get_player_stats(username: str) -> Optional[dict]:
    """Retorna estatísticas detalhadas de um jogador."""
    username = username.strip().lower()

    with get_connection() as conn:
        player = conn.execute(
            "SELECT * FROM scores WHERE username = ?", (username,)
        ).fetchone()

        if not player:
            return None

        data = dict(player)

        rank = conn.execute("""
            SELECT COUNT(*) + 1 as rank FROM scores
            WHERE elo_rating > ? AND games_played > 0
        """, (data['elo_rating'],)).fetchone()
        data['rank'] = rank['rank']

        return data


def get_system_stats() -> dict:
    """Retorna estatísticas gerais do sistema."""
    with get_connection() as conn:
        return {
            'total_players': conn.execute(
                "SELECT COUNT(*) as c FROM players"
            ).fetchone()['c'],
            'total_matches': conn.execute(
                "SELECT COUNT(*) as c FROM matches"
            ).fetchone()['c'],
            'matches_today': conn.execute(
                "SELECT COUNT(*) as c FROM matches WHERE played_at >= date('now')"
            ).fetchone()['c'],
            'active_players': conn.execute(
                "SELECT COUNT(DISTINCT username) as c FROM scores WHERE games_played > 0"
            ).fetchone()['c']
        }
