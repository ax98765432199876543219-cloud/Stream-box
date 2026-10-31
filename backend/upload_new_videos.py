
import os
import mimetypes
from pathlib import Path

import boto3
from dotenv import load_dotenv
from botocore.exceptions import ClientError

# Load the existing backend environment configuration.
load_dotenv(Path(__file__).parent / ".env")

VIDEO_FOLDER = Path(
    "/storage/emulated/0/HARRY/vids"
)

VIDEO_EXTENSIONS = {
    ".mp4", ".mkv", ".avi", ".mov",
    ".webm", ".m4v", ".3gp", ".mpeg", ".mpg"
}


def get_env(*names):
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return None


endpoint = get_env(
    "S3_ENDPOINT_URL",
    "S3_ENDPOINT",
    "AWS_ENDPOINT_URL_S3"
)

access_key = get_env(
    "S3_ACCESS_KEY",
    "S3_ACCESS_KEY_ID",
    "AWS_ACCESS_KEY_ID"
)

secret_key = get_env(
    "S3_SECRET_KEY",
    "S3_SECRET_ACCESS_KEY",
    "AWS_SECRET_ACCESS_KEY"
)

bucket = get_env(
    "S3_BUCKET",
    "S3_BUCKET_NAME",
    "AWS_S3_BUCKET",
    "AWS_STORAGE_BUCKET_NAME"
)

missing = [
    name for name, value in [
        ("S3 endpoint", endpoint),
        ("S3 access key", access_key),
        ("S3 secret key", secret_key),
        ("S3 bucket", bucket),
    ] if not value
]

if missing:
    raise SystemExit(
        "Missing configuration: " + ", ".join(missing)
        + "\nCheck the variable names in your existing backend/.env."
    )

if not VIDEO_FOLDER.is_dir():
    raise SystemExit(f"Video folder not found: {VIDEO_FOLDER}")

s3 = boto3.client(
    "s3",
    endpoint_url=endpoint,
    aws_access_key_id=access_key,
    aws_secret_access_key=secret_key,
    region_name=os.getenv("AWS_DEFAULT_REGION", "auto"),
)


def main():
    print(f"Scanning: {VIDEO_FOLDER}")

    # Read existing S3 object names.
    existing_names = set()
    paginator = s3.get_paginator("list_objects_v2")

    try:
        for page in paginator.paginate(Bucket=bucket):
            for obj in page.get("Contents", []):
                existing_names.add(
                    Path(obj["Key"]).name.casefold()
                )
    except ClientError as exc:
        raise SystemExit(
            f"Could not list S3 objects: {exc}"
        )

    files = sorted(
        p for p in VIDEO_FOLDER.iterdir()
        if p.is_file()
        and p.suffix.lower() in VIDEO_EXTENSIONS
    )

    if not files:
        print("No video files found.")
        return

    uploaded = 0
    skipped = 0
    failed = 0

    for file_path in files:
        name = file_path.name

        if name.casefold() in existing_names:
            print(f"[SKIP] {name} already exists in S3")
            skipped += 1
            continue

        content_type = (
            mimetypes.guess_type(name)[0]
            or "application/octet-stream"
        )

        try:
            print(f"[UPLOAD] {name}")

            s3.upload_file(
                str(file_path),
                bucket,
                name,
                ExtraArgs={"ContentType": content_type}
            )

            print(f"[DONE] {name}")
            existing_names.add(name.casefold())
            uploaded += 1

        except Exception as exc:
            print(f"[FAILED] {name}: {exc}")
            failed += 1

    print("\nUpload summary")
    print(f"Uploaded: {uploaded}")
    print(f"Skipped:  {skipped}")
    print(f"Failed:   {failed}")


if __name__ == "__main__":
    main()
