FROM nvcr.io/nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV OMP_NUM_THREADS=4
ENV NO_TORCH_COMPILE=1
ENV HF_HOME=/home/user/.cache/huggingface

# Install system deps - build-essential needed for compiling sphn (Opus bindings)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    pkg-config \
    libopus-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

# Clone PersonaPlex and install moshi server
RUN git clone https://github.com/NVIDIA/personaplex.git /tmp/personaplex

WORKDIR /app/moshi/
RUN cp -a /tmp/personaplex/moshi/. /app/moshi/ && rm -rf /tmp/personaplex

RUN uv venv /app/moshi/.venv --python 3.12
RUN uv sync

# Create non-root user (HF Spaces requirement)
RUN useradd -m -u 1000 user

# Copy frontend and start script with correct ownership
COPY --chown=user:user frontend/ /app/static/
COPY --chown=user:user start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Give user ownership of the app directory
RUN chown -R user:user /app

USER user

EXPOSE 8998

ENTRYPOINT []
CMD ["/app/start.sh"]
