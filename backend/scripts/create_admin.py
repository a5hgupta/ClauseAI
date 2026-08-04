"""
Promotes an existing user to admin by email. There is no API endpoint for
this deliberately — granting admin rights over HTTP, even behind auth, is a
much bigger attack surface than a one-off operator command run against the
production DB.

Usage (from the backend/ directory, with the venv active or inside the
`api` container):

    python -m scripts.create_admin someone@example.com

The user must already have signed up through the normal flow. This only
flips their role; it does not create an account.
"""
import sys

from app.db.session import SessionLocal
from app.models.user import User


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python -m scripts.create_admin <email>", file=sys.stderr)
        return 2

    email = sys.argv[1].strip().lower()
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).one_or_none()
        if not user:
            print(f"No user found with email {email!r}. They must sign up first.", file=sys.stderr)
            return 1
        if user.role == "admin":
            print(f"{email} is already an admin.")
            return 0
        user.role = "admin"
        db.commit()
        print(f"{email} is now an admin.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
