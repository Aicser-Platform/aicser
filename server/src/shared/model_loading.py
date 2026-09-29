"""One lock for loading local ML models (sentence-transformers, cross-encoders).

Loading imports torch/transformers lazily. Two threads doing that at once (startup warm-ups
for the embedding model and the reranker, or a warm-up plus a user's first search) can
deadlock on those imports; document search then hung until timeout. Every local model load
in the process takes this lock, so loads run one after another.
"""
import threading

MODEL_LOAD_LOCK = threading.RLock()
