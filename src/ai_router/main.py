from fastapi import FastAPI

app = FastAPI(title="AI Router")


@app.get("/health")
async def health():
    return {"status": "ok"}


def cli():
    import uvicorn
    uvicorn.run("ai_router.main:app", host="0.0.0.0", port=8080, reload=True)
