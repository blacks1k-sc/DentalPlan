from flask import Flask, Response, request
import json

app = Flask(__name__)

@app.route('/api/test-stream', methods=['POST'])
def test_stream():
    def generate():
        try:
            yield f"data: {json.dumps({'content': 'Test streaming response', 'type': 'chunk'})}\n\n"
            yield "event: done\ndata: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "event: done\ndata: [DONE]\n\n"
    
    return Response(generate(), mimetype='text/event-stream', headers={
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5003)
