from fastapi import APIRouter

from app.api.routes import auth, contracts, clauses, chat, search, users, admin, billing

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(contracts.router)
api_router.include_router(clauses.router)
api_router.include_router(chat.router)
api_router.include_router(search.router)
api_router.include_router(users.router)
api_router.include_router(admin.router)
api_router.include_router(billing.router)
