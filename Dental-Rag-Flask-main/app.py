import os
from flask import Flask, jsonify, request, Response
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
    enhanced_chat_with_medbot_chunked,
    handle_json_text_input
)
import json
import time
import threading
import queue

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

# Global storage for streaming responses
streaming_responses = {}

@app.route('/')
def hello_world():
    return "<p>RAG Server - Ready</p>"

@app.route('/health')
def health_check():
    return jsonify({"status": "healthy", "service": "rag-functions"}), 200

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

@app.route('/api/test-stream', methods=['GET'])
def test_stream():
    """Simple test streaming endpoint"""
    def generate():
        for i in range(5):
            yield f"data: {json.dumps({'type': 'token', 'content': f'Test message {i+1}', 'done': False})}\n\n"
            time.sleep(0.1)
        yield f"data: {json.dumps({'type': 'done', 'content': '', 'done': True})}\n\n"
    
    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        }
    )

@app.route('/api/rag-chat-stream', methods=['POST'])
def rag_chat_stream():
    """New streaming endpoint that returns responses in real-time"""
    try:
        data = request.get_json()
        
        if not data or "json" not in data or "query" not in data:
            return jsonify({"error": "Missing required fields"}), 400
        
        # Initialize chat history if not provided
        chat_history = data.get("chat_history", [])
        
        def generate_stream():
            try:
                # Use a local variable for chat history
                local_chat_history = chat_history.copy()
                
                # First load the JSON context if provided
                if data["json"]:
                    local_chat_history, _ = handle_json_text_input(data["json"], local_chat_history, data["patient_name"])
                
                # Use chunked streaming for smooth, progressive delivery
                response_stream = enhanced_chat_with_medbot_chunked(
                    question=data["query"],
                    chat_history=local_chat_history,
                    session_id=data["patient_name"],
                    patient_history=data.get("patient_history", [])
                )
                
                # Stream chunks progressively for smooth reading experience
                for chunk in response_stream:
                    if chunk:
                        yield f"data: {json.dumps({'type': 'token', 'content': chunk, 'done': False})}\n\n"
                        # Minimal 2ms delay for smooth streaming
                
                # Send completion signal
                yield f"data: {json.dumps({'type': 'done', 'content': '', 'done': True})}\n\n"
                
            except Exception as e:
                error_data = json.dumps({'type': 'error', 'content': str(e), 'done': True})
                yield f"data: {error_data}\n\n"
        
        return Response(
            generate_stream(),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Cache-Control'
            }
        )
        
    except Exception as e:
        print(f"Error in rag_chat_stream: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/stream-status/<session_id>')
def stream_status(session_id):
    """Check if streaming response is available for a session"""
    if session_id in streaming_responses:
        response_data = streaming_responses[session_id]
        if not response_data["consumed"]:
            response_data["consumed"] = True
            return jsonify({
                "available": True,
                "response": response_data["response"]
            })
    
    return jsonify({"available": False})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)
