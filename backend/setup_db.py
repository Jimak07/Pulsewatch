import sqlite3


connection = sqlite3.connect("database.db")


cursor = connection.cursor()


cursor.execute("""
    CREATE TABLE IF NOT EXISTS Server (
        server_id INTEGER PRIMARY KEY,
        hostname TEXT,
        active_connections INTEGER,
        server_role TEXT,
        is_active INTEGER
    )
""")


connection.commit()
connection.close()

print("Database and table successfully created!")