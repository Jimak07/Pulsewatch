import sqlite3

def migrate_database():

    connection = sqlite3.connect("database.db")
    cursor = connection.cursor()

    try:

        cursor.execute("ALTER TABLE Server ADD COLUMN target_address TEXT DEFAULT '127.0.0.1';")
        connection.commit()
        print("✅ Migration successful: 'target_address' column added to Server table.")
    except sqlite3.OperationalError as e:

        print(f"⚠️ Migration note: {e}")
    finally:
        connection.close()

if __name__ == "__main__":
    migrate_database()