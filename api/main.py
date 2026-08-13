from fastapi import FastAPI

app = FastAPI(title="Discord Bot API")


@app.get("/health")
async def health():
    return {"status": "ok"}
