"""
Modal deployment for Tamil Audio Transcriber.

Deploy:  modal deploy backend/modal_deploy.py
"""

import modal
from pathlib import Path

ROOT = Path(__file__).parent.parent

# ── Volume — persists model weights across container restarts ─────────────────
model_volume = modal.Volume.from_name("tamil-transcriber-models", create_if_missing=True)

MODEL_CACHE = "/model-cache"
MODEL_ID    = "Systran/faster-whisper-large-v3"


def _download_model():
    """Pre-download Whisper weights into the volume during image build."""
    import os
    os.environ["HF_HOME"] = MODEL_CACHE

    from faster_whisper import WhisperModel
    print(f"Downloading {MODEL_ID}...")
    WhisperModel(MODEL_ID, device="cpu", compute_type="int8")
    print("Download complete.")


# ── Image ─────────────────────────────────────────────────────────────────────
image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.2.2-cudnn8-runtime-ubuntu22.04",
        add_python="3.12",
    )
    .apt_install("ffmpeg")
    # Install PyTorch with CUDA 12.1 wheels (compatible with CUDA 12.2 runtime)
    .run_commands(
        "pip install torch --index-url https://download.pytorch.org/whl/cu121"
    )
    .pip_install(
        "fastapi[standard]",
        "uvicorn[standard]",
        "faster-whisper==1.1.0",
        "python-docx==1.1.2",
        "python-multipart==0.0.20",
        "requests",
        "yt-dlp",
        "anthropic",
    )
    .run_function(
        _download_model,
        volumes={MODEL_CACHE: model_volume},
    )
    .add_local_dir(str(ROOT / "backend"),  remote_path="/app/backend")
    .add_local_dir(str(ROOT / "frontend"), remote_path="/app/frontend")
)

# ── Modal app ─────────────────────────────────────────────────────────────────
app = modal.App("tamil-transcriber")


@app.cls(
    image=image,
    gpu="A10G",
    volumes={MODEL_CACHE: model_volume},
    timeout=600,
    scaledown_window=300,
    secrets=[
        modal.Secret.from_name("youtube-cookies"),
        modal.Secret.from_name("anthropic-secret"),
    ],
)
class TamilTranscriber:

    @modal.enter()
    def load_model(self):
        """Runs once when the container starts — loads Whisper into GPU memory."""
        import os
        import sys
        import logging

        os.environ["HF_HOME"] = MODEL_CACHE
        sys.path.insert(0, "/app/backend")

        log = logging.getLogger("transcriber")

        from faster_whisper import WhisperModel, BatchedInferencePipeline
        log.info(f"Loading {MODEL_ID} (float16)...")
        base_model    = WhisperModel(MODEL_ID, device="cuda", compute_type="float16")
        batched_model = BatchedInferencePipeline(model=base_model)
        log.info("Whisper ready.")

        import main
        main.model        = batched_model
        self._fastapi_app = main.app
        self._frontend_mounted = False

    @modal.asgi_app()
    def web(self):
        if not self._frontend_mounted:
            from fastapi.staticfiles import StaticFiles
            self._fastapi_app.mount(
                "/",
                StaticFiles(directory="/app/frontend", html=True),
                name="frontend",
            )
            self._frontend_mounted = True
        return self._fastapi_app
