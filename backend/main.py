import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import settings, videos, process, search

VIDEOS_DIR = str(Path(__file__).parent / "videos")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure videos directory exists
    os.makedirs(VIDEOS_DIR, exist_ok=True)
    # Wire the videos directory into routers
    videos.set_videos_dir(VIDEOS_DIR)
    process.set_videos_dir(VIDEOS_DIR)
    yield


app = FastAPI(
    title="VoyageAI Video Demo API",
    description="Multimodal video embedding demo using voyage-multimodal-3.5 and MongoDB Atlas",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(settings.router, prefix="/api/settings", tags=["Settings"])
app.include_router(videos.router, prefix="/api/videos", tags=["Videos"])
app.include_router(process.router, prefix="/api/process", tags=["Process"])
app.include_router(search.router, prefix="/api/search", tags=["Search"])


@app.get("/health")
async def health():
    return {"status": "ok"}
