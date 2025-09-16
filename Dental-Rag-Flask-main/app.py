import os
import json
import time
import random
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
    enhanced_chat_with_medbot_stream,
    handle_json_text_input,
    transform_anomalies_for_llm
)

def simple_chat_stream(question, chat_history):
    """Simple streaming function without complex session management"""
    try:
        # Just yield some test text without Ollama
        test_text = f"Answer to '{question}': This is a test streaming response."
        for char in test_text:
            yield char
            time.sleep(0.05)  # Slow down for visibility
    except Exception as e:
        yield f"Error: {str(e)}"

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
            
            # Transform anomalies with confidence filtering and grouping
            confidence_threshold = data.get("confidence_threshold", 0.50)
            transformed_anomalies = transform_anomalies_for_llm(json_content, confidence_threshold)
            
            # Create enhanced JSON content with grouped anomalies
            enhanced_json_content = json_content.copy()
            if "anomalies_grouped" in transformed_anomalies:
                enhanced_json_content["anomalies_grouped"] = transformed_anomalies["anomalies_grouped"]
            if "suspected_anomalies" in transformed_anomalies:
                enhanced_json_content["suspected_anomalies"] = transformed_anomalies["suspected_anomalies"]
            
            chat_history,_ = handle_json_text_input(enhanced_json_content, chat_history, data["patient_name"])
            print("Finished loading with grouped anomalies")
            
            # If no query, return the last message from chat_history with anomaly info
            if not data.get("query") or not data["query"].strip():
                response_data = {
                    "message": "✅ JSON context loaded with grouped anomalies.",
                    "context_loaded": True,
                    "anomaly_summary": {
                        "total_anomalies": transformed_anomalies.get("total_anomalies", 0),
                        "filtered_anomalies": transformed_anomalies.get("filtered_anomalies", 0),
                        "confidence_threshold": transformed_anomalies.get("confidence_threshold", 0.50),
                        "grouped_count": len(transformed_anomalies.get("anomalies_grouped", [])),
                        "suspected_count": len(transformed_anomalies.get("suspected_anomalies", []))
                    }
                }
                if chat_history:
                    response_data["message"] = chat_history[-1]
                return jsonify(response_data), 200

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

@app.route('/api/xray-upload', methods=['POST'])
def xray_upload():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Request must include JSON data."}), 400

        patientId = data.get('patientId')
        visitId = data.get('visitId')
        annotationData = data.get('annotationData')

        if not patientId or not visitId or not annotationData:
            return jsonify({"error": "patientId, visitId, and annotationData are required."}), 400

        # Process the annotation data (placeholder implementation)
        # In a real implementation, you would process the annotations here
        annotations_found = 0
        if annotationData.get('annotations'):
            annotations_found = len(annotationData['annotations'])

        return jsonify({
            "status": "success",
            "message": f"X-ray annotations processed successfully for patient {patientId}, visit {visitId}",
            "annotationsFound": annotations_found,
            "patientId": patientId,
            "visitId": visitId
        }), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/anomalies', methods=['POST'])
def get_anomalies():
    """Return processed anomalies with confidence filtering and grouping"""
    try:
        data = request.get_json()
        if not data or "json" not in data:
            return jsonify({"error": "Request must include 'json' data."}), 400
        
        # Get confidence threshold from request (default 0.50)
        confidence_threshold = data.get("confidence_threshold", 0.50)
        
        # Transform anomalies with confidence filtering and grouping
        transformed_anomalies = transform_anomalies_for_llm(data["json"], confidence_threshold)
        
        return jsonify({
            "status": "success",
            "anomalies_grouped": transformed_anomalies.get("anomalies_grouped", []),
            "suspected_anomalies": transformed_anomalies.get("suspected_anomalies", []),
            "confidence_threshold": transformed_anomalies.get("confidence_threshold", confidence_threshold),
            "summary": {
                "total_anomalies": transformed_anomalies.get("total_anomalies", 0),
                "filtered_anomalies": transformed_anomalies.get("filtered_anomalies", 0),
                "grouped_count": len(transformed_anomalies.get("anomalies_grouped", [])),
                "suspected_count": len(transformed_anomalies.get("suspected_anomalies", []))
            }
        }), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/rag-chat-stream', methods=['POST'])
def rag_chat_stream():
    """Streaming endpoint for real-time LLM responses"""
    try:
        # Get request data inside the route function (not in generator)
        data = request.get_json()
        print(f"🔍 Received request data: {data}")
        
        if not data:
            return Response(
                f"data: {json.dumps({'error': 'Request must include JSON data'})}\n\n",
                mimetype='text/event-stream',
                headers={
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-Accel-Buffering': 'no',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type'
                }
            )

        chat_history = []

        # Step 1: If JSON is provided, load context
        if "json" in data and data["json"]:
            json_content = data["json"]
            
            # Transform anomalies with confidence filtering and grouping
            confidence_threshold = data.get("confidence_threshold", 0.50)
            transformed_anomalies = transform_anomalies_for_llm(json_content, confidence_threshold)
            
            # Create enhanced JSON content with grouped anomalies
            enhanced_json_content = json_content.copy()
            if "anomalies_grouped" in transformed_anomalies:
                enhanced_json_content["anomalies_grouped"] = transformed_anomalies["anomalies_grouped"]
            if "suspected_anomalies" in transformed_anomalies:
                enhanced_json_content["suspected_anomalies"] = transformed_anomalies["suspected_anomalies"]
            
            patient_name_for_context = data.get("patient_name", data.get("patient_id", "default_patient"))
            chat_history, _ = handle_json_text_input(enhanced_json_content, chat_history, patient_name_for_context)
            
            # If no query, return context loaded message
            if not data.get("query") or not data["query"].strip():
                context_message = "✅ JSON context loaded with grouped anomalies."
                return Response(
                    f"data: {json.dumps({'content': context_message, 'type': 'context'})}\n\nevent: done\ndata: [DONE]\n\n",
                    mimetype='text/event-stream',
                    headers={
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                        'X-Accel-Buffering': 'no',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': 'Content-Type'
                    }
                )

        # Step 2: If query is provided, stream the answer
        if "query" in data and data["query"].strip():
            question = data["query"]
            patient_name = data.get("patient_name", data.get("patient_id", "default_patient"))
            patient_history = data.get("patient_history", [])
            
            def generate():
                try:
                    print(f"Starting streaming for question: {question}")
                    chunk_count = 0
                    last_heartbeat = time.time()
                    
                    for chunk in enhanced_chat_with_medbot_stream(
                        question=question,
                        chat_history=chat_history,
                        session_id=patient_name,
                        patient_history=patient_history
                    ):
                        if chunk:
                            chunk_count += 1
                            print(f"Streaming chunk {chunk_count}: {chunk[:50]}...")
                            # Send the chunk with consistent JSON format
                            chunk_data = f"data: {json.dumps({'content': chunk, 'type': 'chunk'})}\n\n"
                            yield chunk_data
                            
                            # Send heartbeat if needed
                            current_time = time.time()
                            if current_time - last_heartbeat > 15:
                                yield ": ping\n\n"
                                last_heartbeat = current_time
                    
                    print(f"Streaming completed. Total chunks: {chunk_count}")
                    
                    # Send completion event
                    yield "event: done\ndata: [DONE]\n\n"
                    
                except Exception as e:
                    print(f"Error in streaming generator: {e}")
                    error_message = f"⚠️ Error processing your question: {str(e)}"
                    yield f"data: {json.dumps({'content': error_message, 'type': 'error'})}\n\n"
                    yield "event: done\ndata: [DONE]\n\n"

            return Response(generate(), mimetype='text/event-stream', headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type'
            })
        else:
            return Response(
                f"data: {json.dumps({'error': 'No valid query provided'})}\n\nevent: done\ndata: [DONE]\n\n",
                mimetype='text/event-stream',
                headers={
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-Accel-Buffering': 'no',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type'
                }
            )

    except Exception as e:
        print(f"Unhandled error in rag_chat_stream: {e}")
        return Response(
            f"data: {json.dumps({'error': str(e)})}\n\nevent: done\ndata: [DONE]\n\n",
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        )

@app.route('/api/test-stream', methods=['GET'])
def test_stream():
    """Test endpoint to verify SSE streaming works"""
    def generate():
        for i in range(10):
            yield f"data: {json.dumps({'content': f'Test chunk {i+1}', 'type': 'test'})}\n\n"
            time.sleep(0.5)  # Wait 0.5 seconds between chunks
        yield "event: done\ndata: [DONE]\n\n"
    
    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
            'Access-Control-Allow-Origin': '*'
        }
    )

@app.route('/health')
def health_check():
    return jsonify({
        "status": "healthy", 
        "service": "rag-functions",
        "streaming": "enabled",
        "timestamp": time.time()
    }), 200

@app.route('/api/test-simple-stream', methods=['POST'])
def test_simple_stream():
    """Simple test streaming endpoint"""
    def generate():
        try:
            for i in range(5):
                yield f"data: {json.dumps({'content': f'Test chunk {i+1}', 'type': 'test'})}\n\n"
                time.sleep(0.5)
            yield "event: done\ndata: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e), 'type': 'error'})}\n\n"
    
    return Response(generate(), mimetype='text/event-stream', headers={
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)
