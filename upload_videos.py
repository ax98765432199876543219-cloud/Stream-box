
import os
import socket
from pathlib import Path

import boto3
import dns.resolver
from dotenv import load_dotenv
from botocore.client import Config
from botocore.exceptions import ClientError, BotoCoreError


# Load existing project credentials
PROJECT_DIR = Path.home() / "video-app"
load_dotenv(PROJECT_DIR / ".env", override=True)

ENDPOINT = os.environ["AWS_ENDPOINT_URL_S3"].rstrip("/")
BUCKET = os.environ["S3_BUCKET_NAME"]
REGION = os.environ.get("AWS_REGION", "ap-southeast-1")

VIDEO_DIR = Path("/storage/emulated/0/HARRY/vids")

# Preserve the DNS workaround used by your Flask app
S3_HOST = ENDPOINT.split("://", 1)[1].split("/", 1)[0]
original_getaddrinfo = socket.getaddrinfo

resolver = dns.resolver.Resolver(configure=False)
resolver.nameservers = ["8.8.8.8", "8.8.4.4"]
resolver.timeout = 5
resolver.lifetime = 10


def s3_dns_workaround(host, port, *args, **kwargs):
    if isinstance(host, str) and host.rstrip(".") == S3_HOST.rstrip("."):
        try:
            return original_getaddrinfo(host, port, *args, **kwargs)
        except socket.gaierror:
            pass

        try:
            addresses = resolver.resolve(S3_HOST, "A")
            for address in addresses:
                try:
                    return original_getaddrinfo(
                        address.address, port, *args, **kwargs
                    )
                except socket.gaierror:
                    continue
        except Exception as exc:
            raise socket.gaierror(
                f"Cannot resolve S3 hostname: {S3_HOST}"
            ) from exc

        raise socket.gaierror(f"Cannot resolve S3 hostname: {S3_HOST}")

    return original_getaddrinfo(host, port, *args, **kwargs)


socket.getaddrinfo = s3_dns_workaround

s3 = boto3.client(
    "s3",
    endpoint_url=ENDPOINT,
    aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
    region_name=REGION,
    config=Config(
        signature_version="s3v4",
        s3={"addressing_style": "path"},
        connect_timeout=15,
        read_timeout=120,
        retries={"max_attempts": 3},
    ),
)

VIDEO_EXTENSIONS = {
    ".mp4", ".m4v", ".webm", ".mov", ".mkv", ".avi"
}


def main():
    if not VIDEO_DIR.is_dir():
        print(f"Folder not found: {VIDEO_DIR}")
        return

    videos = sorted(
        (
            path for path in VIDEO_DIR.iterdir()
            if path.is_file()
            and path.suffix.lower() in VIDEO_EXTENSIONS
        ),
        key=lambda path: path.name.lower(),
    )

    if not videos:
        print("No supported video files found in the folder.")
        return

    total_bytes = sum(path.stat().st_size for path in videos)

    print(f"Bucket: {BUCKET}")
    print(f"Videos found: {len(videos)}")
    print(f"Total size: {total_bytes / (1024**3):.2f} GB")
    print("Starting upload...\n")

    uploaded = 0
    failed = []

    for index, path in enumerate(videos, start=1):
        # Store videos at the bucket root using their filenames.
        key = path.name

        print(f"[{index}/{len(videos)}] Uploading: {path.name}")

        try:
            s3.upload_file(str(path), BUCKET, key)
            uploaded += 1
            print("    SUCCESS")
        except (ClientError, BotoCoreError, OSError) as exc:
            failed.append(path.name)
            print(f"    FAILED: {exc}")

    print("\n========== UPLOAD SUMMARY ==========")
    print(f"Successful: {uploaded}/{len(videos)}")
    print(f"Failed: {len(failed)}")

    if failed:
        print("\nFailed files:")
        for name in failed:
            print(f" - {name}")

    print("\nRefresh your video app to check the uploaded files.")


if __name__ == "__main__":
    main()
