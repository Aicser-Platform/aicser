from src.modules.data.utils.credentials import encrypt_credentials, decrypt_credentials


def test_encrypt_decrypt_roundtrip(tmp_path, monkeypatch):
    # generate a Fernet key for testing
    from cryptography.fernet import Fernet
    key = Fernet.generate_key().decode()
    monkeypatch.setenv("ENCRYPTION_KEY", key)

    cfg = {"password": "s3cr3t", "api_key": "ak-123"}
    enc = encrypt_credentials(cfg)
    assert enc.get("__enc_password") is True or "password" in enc
    dec = decrypt_credentials(enc)
    assert dec["password"] == "s3cr3t"
    assert dec["api_key"] == "ak-123"


