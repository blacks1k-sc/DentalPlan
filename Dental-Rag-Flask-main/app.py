import os
from flask import Flask, jsonify, request
from flask_cors import CORS
import faiss
import pickle
from sentence_transformers import SentenceTransformer
import ollama
from claude_try import (
    extract_anomalies,
    json_to_full_text,
    format_finding_matches,
    enhanced_chat_with_medbot,
    handle_json_text_input
)

# Initialize Flask app
app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
app.config['PERMANENT_SESSION_LIFETIME'] = 300
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Global variables for RAG context
current_json_context = None
current_cdt_matches = None
current_findings = None

@app.route('/api/rag-chat', methods=['POST'])
def rag_chat():
    global current_json_context, current_cdt_matches, current_findings

    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Request must include 'json' or 'query'."}), 400

        chat_history = []

        # Step 1: If JSON is provided, load context
        if "json" in data and data["json"]:
            json_content = data["json"]
            chat_history,_ = handle_json_text_input(data["json"], chat_history, data["patient_name"])
            print("Finished loading")
            # If no query, return the last message from chat_history
            if not data.get("query") or not data["query"].strip():
                if chat_history:
                    last_message = chat_history[-1]
                    return jsonify({"message": last_message, "context_loaded": True}), 200
                else:
                    return jsonify({"message": "✅ JSON context loaded.", "context_loaded": True}), 200

        # Step 2: If query is provided, generate answer
        if "query" in data and data["query"].strip():
            question = data["query"]
            print("Starting query")
            _, updated_history = enhanced_chat_with_medbot(
            question=question,
            chat_history=chat_history,
            session_id=data["patient_name"],
            patient_history=data.get("patient_history", [])
            )
            print("Finished query")
            return jsonify({"answer": updated_history[-1][1]}), 200

        return jsonify({"error": "No valid query provided."}), 400

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/')
def hello_world():
    return "<p>RAG Server - Ready</p>"

@app.route('/health')
def health_check():
    return jsonify({"status": "healthy", "service": "rag-functions"}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)
