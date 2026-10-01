# Aicser notebook runner (Enterprise): scheduled notebook runs in Pyodide (MPL-2.0) on Deno (MIT).
FROM denoland/deno:debian-2.9.7

ARG PYODIDE_VERSION=0.28.3
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl bzip2 ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /runner

# Pyodide core (~5 MB) plus the packages notebooks use, vendored and checksum-verified so runs
# never reach the internet.
RUN curl -fsSL "https://github.com/pyodide/pyodide/releases/download/${PYODIDE_VERSION}/pyodide-core-${PYODIDE_VERSION}.tar.bz2" \
    | tar -xj -C /runner
COPY fetch_packages.ts ./
RUN deno run --allow-read=/runner --allow-write=/runner/pyodide --allow-net=cdn.jsdelivr.net fetch_packages.ts "${PYODIDE_VERSION}"

# The same Python helpers and aicser.* bridge as the browser notebook.
COPY --from=notebook aicser_helpers.py /runner/aicser_helpers.py
COPY --from=bridge pythonBridge.ts /runner/pythonBridge.ts
RUN sed -i "s#^import type { Frame } from '../hooks/usePythonRuntime';#type Frame = { columns: string[]; rows: unknown[][] };#" /runner/pythonBridge.ts \
 && grep -q "type Frame = " /runner/pythonBridge.ts

COPY main.ts run_worker.ts ./
RUN deno cache main.ts run_worker.ts \
 && chown -R root:root /runner && chmod -R a-w /runner

USER deno
EXPOSE 8200
CMD ["deno", "run", "--no-prompt", "--unstable-worker-options", \
     "--allow-read=/runner", \
     "--allow-net=0.0.0.0:8200,server:8000", \
     "--allow-env=RUNNER_KEY,RUNNER_CALLBACK_HOST", \
     "main.ts"]
