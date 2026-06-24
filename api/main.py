from fastapi import FastAPI
from contextlib import asynccontextmanager
from api.database import engine, Base


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


app = FastAPI(title="Discord Bot API", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}
