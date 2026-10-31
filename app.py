import os
from flask import Flask, jsonify
from dotenv import load_dotenv
import boto3

# Load .env
load_dotenv()

app = Flask(__name__)

# ============================================================
# Neon PostgreSQL
# ============================================================

DATABASE_URL = os.getenv("DATABASE_URL")

# ============================================================
# Neon Object Storage / S3
# ============================================================

S3_ENDPOINT = os.getenv("AWS_ENDPOINT_URL_S3")
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.getenv("AWS_REGION", "ap-southeast-1")

# Put your Neon bucket name here
S3_BUCKET = os.getenv("S3_BUCKET")

# Create S3 client
s3 = boto3.client(
    "s3",
    endpoint_url=S3_ENDPOINT,
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    region_name=AWS_REGION
)


# ============================================================
# Home / Health Check
# ============================================================

@app.route("/")
def home():
    return jsonify({
        "message": "Video App Backend is running",
        "status": "OK"
    })


# ============================================================
# List videos from Neon Object Storage
# ============================================================

@app.route("/api/videos", methods=["GET"])
def get_videos():

    try:
        response = s3.list_objects_v2(
            Bucket=S3_BUCKET
        )

        videos = []

        for obj in response.get("Contents", []):

            filename = obj["Key"]

            # Only show video files
            if filename.lower().endswith(
                (".mp4", ".mkv", ".mov", ".avi", ".webm")
            ):

                # Generate temporary URL
                video_url = s3.generate_presigned_url(
                    "get_object",
                    Params={
                        "Bucket": S3_BUCKET,
                        "Key": filename
                    },
                    ExpiresIn=3600
                )

                videos.append({
                    "filename": filename,
                    "size": obj["Size"],
                    "url": video_url
                })

        return jsonify(videos)

    except Exception as e:

        return jsonify({
            "error": str(e)
        }), 500


# ============================================================
# Run Flask
# ============================================================

if __name__ == "__main__":

    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True
    )
