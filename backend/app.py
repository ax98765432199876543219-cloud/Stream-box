
import os
import re
import socket
import mimetypes
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError, BotoCoreError
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.utils import secure_filename

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

load_dotenv(HERE / ".env")
load_dotenv(ROOT / ".env", override=False)

app = Flask(__name__)
CORS(app)

app.config["MAX_CONTENT_LENGTH"] = (
    int(os.getenv("MAX_UPLOAD_MB", "4096")) * 1024 * 1024
)

EXTENSIONS = {
    ".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v",
    ".3gp", ".mpeg", ".mpg", ".ts"
}

URL_TTL = int(os.getenv("S3_URL_EXPIRY_SECONDS", "3600"))


def env_first(*names, default=None):
    for name in names:
        value = os.getenv(name)
        if value:
            return value.strip()
    return default


ENDPOINT = env_first(
    "S3_ENDPOINT_URL", "S3_ENDPOINT", "AWS_ENDPOINT_URL_S3",
    "NEON_S3_ENDPOINT", "AWS_S3_ENDPOINT_URL"
)

ACCESS = env_first(
    "S3_ACCESS_KEY", "S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID",
    "NEON_S3_ACCESS_KEY", "AWS_ACCESS_KEY"
)

SECRET = env_first(
    "S3_SECRET_KEY", "S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY",
    "NEON_S3_SECRET_KEY", "AWS_SECRET_KEY"
)

BUCKET = env_first(
    "S3_BUCKET", "S3_BUCKET_NAME", "AWS_S3_BUCKET",
    "AWS_STORAGE_BUCKET_NAME", "NEON_S3_BUCKET", "BUCKET_NAME"
)

REGION = env_first("AWS_DEFAULT_REGION", "AWS_REGION", default="auto")
QUOTA_GB = env_first("S3_FREE_TIER_GB", "STORAGE_QUOTA_GB")


# DNS fallback for Termux if Android's DNS resolver fails.
# Requires: python -m pip install dnspython
try:
    import dns.resolver

    _original_getaddrinfo = socket.getaddrinfo

    def _termux_getaddrinfo(
        host, port, family=0, type=0, proto=0, flags=0
    ):
        try:
            return _original_getaddrinfo(
                host, port, family, type, proto, flags
            )
        except socket.gaierror:
            if not isinstance(host, str):
                raise

            resolver = dns.resolver.Resolver(configure=False)
            resolver.nameservers = ["1.1.1.1", "8.8.8.8"]
            resolver.timeout = 3
            resolver.lifetime = 5

            addresses = []

            for record in ("A", "AAAA"):
                try:
                    addresses.extend(
                        str(address)
                        for address in resolver.resolve(host, record)
                    )
                except Exception:
                    pass

            results = []

            for address in dict.fromkeys(addresses):
                try:
                    results.extend(
                        _original_getaddrinfo(
                            address, port, family, type, proto, flags
                        )
                    )
                except socket.gaierror:
                    pass

            if results:
                return results

            raise

    socket.getaddrinfo = _termux_getaddrinfo

except ImportError:
    pass


def s3_client():
    missing = [
        label
        for label, value in [
            ("endpoint", ENDPOINT),
            ("access key", ACCESS),
            ("secret key", SECRET),
            ("bucket", BUCKET),
        ]
        if not value
    ]

    if missing:
        raise RuntimeError(
            "Missing S3 configuration: "
            + ", ".join(missing)
            + ". Check your existing backend/.env file."
        )

    return boto3.client(
        "s3",
        endpoint_url=ENDPOINT,
        aws_access_key_id=ACCESS,
        aws_secret_access_key=SECRET,
        region_name=REGION,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            retries={"max_attempts": 3, "mode": "standard"},
            connect_timeout=15,
            read_timeout=120,
        ),
    )


def public_error(exc):
    message = str(exc)
    message = re.sub(
        r"(?i)(secret|access.?key|password|token)\s*[=:]\s*\S+",
        r"\1=[redacted]",
        message,
    )

    if isinstance(exc, (BotoCoreError, ClientError)):
        return f"Storage request failed: {message}"

    return f"{type(exc).__name__}: {message}"


def human_bytes(number):
    if number is None:
        return None

    number = float(number)

    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(number) < 1024 or unit == "TB":
            if unit == "B":
                return f"{int(number)} B"
            return f"{number:.1f} {unit}"

        number /= 1024


def all_objects(client):
    found = []

    paginator = client.get_paginator("list_objects_v2")

    for page in paginator.paginate(Bucket=BUCKET):
        for obj in page.get("Contents", []):
            key = obj["Key"]

            found.append({
                "key": key,
                "name": Path(key).name,
                "size": int(obj.get("Size", 0)),
                "last_modified": (
                    obj["LastModified"].isoformat()
                    if obj.get("LastModified")
                    else None
                ),
            })

    return found


def video_name(raw):
    name = Path(raw.replace("\\", "/")).name
    safe = secure_filename(name)

    if not safe or Path(safe).suffix.lower() not in EXTENSIONS:
        raise ValueError("Unsupported video filename or format.")

    return safe


@app.get("/api/health")
def health():
    return jsonify({
        "ok": True,
        "service": "streambox-api"
    })


@app.get("/api/videos")
def videos():
    try:
        client = s3_client()
        objects = all_objects(client)
        result = []

        for obj in objects:
            if Path(obj["name"]).suffix.lower() not in EXTENSIONS:
                continue

            result.append({
                **obj,
                "url": client.generate_presigned_url(
                    "get_object",
                    Params={
                        "Bucket": BUCKET,
                        "Key": obj["key"],
                    },
                    ExpiresIn=URL_TTL,
                ),
            })

        result.sort(
            key=lambda item: (
                item["name"].casefold(),
                item["key"]
            )
        )

        return jsonify({
            "videos": result,
            "count": len(result),
        })

    except Exception as exc:
        app.logger.exception("Could not list videos")
        return jsonify({"error": public_error(exc)}), 502


@app.get("/api/storage")
def storage():
    try:
        objects = all_objects(s3_client())
        used = sum(item["size"] for item in objects)
        quota = None

        try:
            if QUOTA_GB:
                quota = int(float(QUOTA_GB) * 1024**3)
        except ValueError:
            pass

        remaining = max(0, quota - used) if quota else None

        return jsonify({
            "object_count": len(objects),
            "video_count": sum(
                Path(item["name"]).suffix.lower() in EXTENSIONS
                for item in objects
            ),
            "used_bytes": used,
            "used_human": human_bytes(used),
            "quota_bytes": quota,
            "quota_human": human_bytes(quota) if quota else None,
            "remaining_bytes": remaining,
            "remaining_human": human_bytes(remaining) if remaining is not None else None,
            "note": (
                "Configured quota is an estimate, "
                "not a live Neon billing meter."
            ),
        })

    except Exception as exc:
        app.logger.exception("Could not calculate storage")
        return jsonify({"error": public_error(exc)}), 502


@app.post("/api/upload")
def upload():
    uploaded_file = request.files.get("file")

    if uploaded_file is None or not uploaded_file.filename:
        return jsonify({"error": "Choose a video file first."}), 400

    try:
        name = video_name(uploaded_file.filename)
        client = s3_client()

        # Skip a duplicate filename instead of uploading it again.
        try:
            client.head_object(Bucket=BUCKET, Key=name)

            return jsonify({
                "ok": True,
                "skipped": True,
                "name": name,
                "key": name,
                "message": "An object with this filename already exists.",
            })

        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", ""))
            status = exc.response.get("ResponseMetadata", {}).get(
                "HTTPStatusCode"
            )

            if code not in {"404", "NoSuchKey", "NotFound"} and status != 404:
                raise

        content_type = (
            uploaded_file.mimetype
            or mimetypes.guess_type(name)[0]
            or "application/octet-stream"
        )

        client.upload_fileobj(
            uploaded_file,
            BUCKET,
            name,
            ExtraArgs={"ContentType": content_type},
        )

        return jsonify({
            "ok": True,
            "skipped": False,
            "name": name,
            "key": name,
            "message": "Video uploaded successfully.",
        }), 201

    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    except Exception as exc:
        app.logger.exception("Upload failed")
        return jsonify({"error": public_error(exc)}), 502


@app.delete("/api/videos/<path:key>")
def delete_video(key):
    key = key.strip("/")

    if (
        not key
        or ".." in Path(key).parts
        or Path(key).suffix.lower() not in EXTENSIONS
    ):
        return jsonify({"error": "Invalid video key."}), 400

    try:
        client = s3_client()
        client.head_object(Bucket=BUCKET, Key=key)
        client.delete_object(Bucket=BUCKET, Key=key)

        return jsonify({
            "ok": True,
            "deleted": key,
        })

    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        status = exc.response.get("ResponseMetadata", {}).get(
            "HTTPStatusCode"
        )

        if code in {"404", "NoSuchKey", "NotFound"} or status == 404:
            return jsonify({"error": "Video not found in storage."}), 404

        app.logger.exception("Delete failed")
        return jsonify({"error": public_error(exc)}), 502

    except Exception as exc:
        app.logger.exception("Delete failed")
        return jsonify({"error": public_error(exc)}), 502


@app.errorhandler(413)
def too_large(_error):
    return jsonify({
        "error": "File exceeds the MAX_UPLOAD_MB configured upload limit."
    }), 413


if __name__ == "__main__":
    app.run(
        host=os.getenv("FLASK_HOST", "127.0.0.1"),
        port=int(os.getenv("FLASK_PORT", "5000")),
        debug=os.getenv("FLASK_DEBUG", "false").lower() == "true",
    )
