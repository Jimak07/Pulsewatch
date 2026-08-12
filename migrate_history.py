import sqlite3

def create_healthchecks_table():
    connection = sqlite3.connect("database.db")
    cursor = connection.cursor()

    try:
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS HealthChecks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            server_id INTEGER NOT NULL,
            status INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            FOREIGN KEY (server_id) REFERENCES Server(server_id) ON DELETE CASCADE
        );
        """)
        connection.commit()
        print("✅ Migration successful: 'HealthChecks' table created.")
    except sqlite3.Error as e:
        print(f"⚠️ Database error: {e}")
    finally:
        connection.close()

if __name__ == "__main__":
    create_healthchecks_table()