import json
import os
import pandas as pd
from ollama_embedder import CDTEmbedder
from langchain_community.llms import Ollama
from langchain_core.prompts import PromptTemplate
from langchain.chains import LLMChain
from uuid import uuid4
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Union

# Load LLaMA model via Ollama
llm = Ollama(model="mistral:latest")
print("✅ (Ollama) model loaded.")

# Load CDT Embedder
cdt = CDTEmbedder("New_CDT.xlsx")

# Simplified Session State (No SQL)
class SessionState:
    def __init__(self):
        self.sessions = {}
    
    def get_session(self, session_id):
        if session_id not in self.sessions:
            self.sessions[session_id] = {
                'threads': {
                    'default': {
                        'json_context': None,
                        'cdt_matches': None,
                        'findings': None,
                        'chat_history': [],
                        'name': 'Default Case',
                        'json_text': "",
                        'patient_id': None,
                        'visit_id': None,
                        'thread_type': 'scenario',
                        'patient_history': []  # Store history in memory
                    }
                },
                'current_thread': 'default',
                'current_patient_id': None,
                'patient_name': None,
                'patient_history': []  # Store all patient history in memory
            }
        return self.sessions[session_id]
    
    def set_current_patient(self, session_id: str, patient_id: str, patient_name: str, patient_history: List[dict] = None):
        """Set current patient for the session with optional history from MongoDB"""
        session = self.get_session(session_id)
        session['current_patient_id'] = patient_id
        session['patient_name'] = patient_name
        session['patient_history'] = patient_history or []
        
        current_thread = session['threads'][session['current_thread']]
        current_thread['patient_id'] = patient_id
        current_thread['visit_id'] = str(uuid4())
        current_thread['name'] = f"📋 Visit: {patient_name} - Current Visit"
        current_thread['patient_history'] = patient_history or []
        
        return len(session['patient_history'])
    
    def get_patient_context(self, session_id: str) -> str:
        """Build patient context for AI from visit history"""
        session = self.get_session(session_id)
        if not session['current_patient_id']:
            return ""
        
        history = session['patient_history']
        if not history:
            return f"New patient: {session['patient_name']} - No previous visits."
        
        context_parts = [f"Patient: {session['patient_name']} - {len(history)} previous visits"]
        
        for i, visit in enumerate(history):
            visit_date = visit.get('timestamp', 'Unknown date')
            context_parts.append(f"\n--- Visit {i+1} ({visit_date}) ---")
            
            if visit.get('findings'):
                context_parts.append(f"Findings: {json.dumps(visit['findings'])}")
            
            if visit.get('cdt_matches'):
                context_parts.append(f"CDT Matches: {visit['cdt_matches']}")
        
        return "\n".join(context_parts)
    
    def create_thread(self, session_id, thread_name, thread_type='scenario'):
        """Create thread with explicit type: 'scenario' or 'visit'"""
        session = self.get_session(session_id)
        thread_id = f"thread_{len(session['threads'])}"
        type_prefix = "🔬 Scenario: " if thread_type == 'scenario' else "📋 Visit: "
        display_name = f"{type_prefix}{thread_name}"
        
        session['threads'][thread_id] = {
            'json_context': None,
            'cdt_matches': None,
            'findings': None,
            'chat_history': [],
            'name': display_name,
            'json_text': "",
            'patient_id': session['current_patient_id'],
            'visit_id': str(uuid4()) if thread_type == 'visit' else None,
            'thread_type': thread_type,
            'patient_history': session.get('patient_history', [])
        }
        session['current_thread'] = thread_id
        return thread_id
    
    def get_visit_comparison_data(self, session_id, visit_ids=None):
        """Get data for comparing multiple visits"""
        session = self.get_session(session_id)
        if not session['current_patient_id']:
            return "No patient selected for comparison."
        
        history = session['patient_history']
        if len(history) < 2:
            return "Need at least 2 visits for comparison."
        
        if not visit_ids:
            visits_to_compare = history[:3]  # Last 3 visits
        else:
            visits_to_compare = [v for v in history if v.get('visit_id') in visit_ids]
        
        comparison_data = {
            'patient_name': session['patient_name'],
            'visits': []
        }
        
        for visit in visits_to_compare:
            visit_date = visit.get('timestamp', 'Unknown date')
            visit_data = {
                'date': visit_date,
                'visit_id': visit.get('visit_id', 'unknown'),
                'findings': visit.get('findings', []),
                'findings_count': len(visit.get('findings', [])),
                'teeth_affected': list(set([f['tooth'] for f in visit.get('findings', [])])),
                'cdt_matches': visit.get('cdt_matches', '')
            }
            comparison_data['visits'].append(visit_data)
        
        return comparison_data
    
    def switch_thread(self, session_id, thread_id):
        session = self.get_session(session_id)
        if thread_id in session['threads']:
            session['current_thread'] = thread_id
    
    def get_current_thread(self, session_id):
        session = self.get_session(session_id)
        return session['threads'].get(session['current_thread'], None)
    
    def get_thread_list(self, session_id):
        session = self.get_session(session_id)
        return [{'id': tid, 'name': t['name']} for tid, t in session['threads'].items()]
    
    def clear_thread(self, session_id, thread_id):
        session = self.get_session(session_id)
        if thread_id in session['threads']:
            del session['threads'][thread_id]
            if session['current_thread'] == thread_id:
                session['current_thread'] = 'default' if 'default' in session['threads'] else next(iter(session['threads'].keys()), None)
    
    def clear_session(self, session_id):
        if session_id in self.sessions:
            del self.sessions[session_id]

session_state = SessionState()

# Helper functions
def save_results_to_excel(new_rows, filename="medbot_output_claude.xlsx"):
    df_new = pd.DataFrame(new_rows)
    if os.path.exists(filename):
        df_existing = pd.read_excel(filename)
        df_combined = pd.concat([df_existing, df_new], ignore_index=True)
    else:
        df_combined = df_new
    df_combined.to_excel(filename, index=False)
    print(f"✅ Appended output saved to {filename}")

def extract_anomalies(data):
    """Extract ONLY anomalies that have metadata"""
    findings = []
    for tooth in data.get("teeth", []):
        number = tooth['number']
        for anom in tooth.get("anomalies", []):
            metadata = anom.get("metadata", {})
            if metadata:
                desc = anom.get("description", "")
                findings.append({
                    "tooth": number,
                    "description": desc,
                    "metadata": metadata
                })
    return findings

def format_finding_matches(findings):
    """Format ONLY findings with metadata for treatment plan"""
    formatted = []
    output_records = []
    if not findings:
        return "No anomalies with metadata found.", []
    for finding in findings:
        text = f"Tooth {finding['tooth']}: {finding['description']}"
        top_codes, _ = cdt.retrieve_best_match(text)
        lines = [f"Finding: {text}"]
        lines.append(f"Metadata: {json.dumps(finding['metadata'], indent=2)}")
        lines.append("Relevant CDT Codes:")
        if top_codes.empty:
            lines.append("No matching CDT code found.")
            cdt_codes_str = "No matching CDT code found."
        else:
            cdt_codes = []
            for _, row in top_codes.iterrows():
                lines.append(f"- {row['Code']}: {row['Description']}")
                cdt_codes.append(row['Code'])
            cdt_codes_str = ", ".join(cdt_codes)
        formatted.append("\n".join(lines))
        output_records.append({
            "Tooth No": finding["tooth"],
            "Anomaly Description": finding["description"],
            "Metadata": json.dumps(finding["metadata"], ensure_ascii=False),
            "CDT Codes": cdt_codes_str
        })
    return "\n\n".join(formatted), output_records

def json_to_full_text(data):
    """Convert entire JSON to comprehensive text context"""
    parts = []
    if "imagePath" in data:
        parts.append(f"Image: {data['imagePath']} ({data['imageWidth']}x{data['imageHeight']})")
    for tooth in data.get("teeth", []):
        number = tooth['number']
        tooth_info = [f"Tooth {number}:"]
        anomalies = tooth.get("anomalies", [])
        if anomalies:
            anomaly_list = []
            for anom in anomalies:
                desc = anom.get("description", "")
                metadata = anom.get("metadata", {})
                if metadata:
                    anomaly_list.append(f"{desc} (with metadata)")
                else:
                    anomaly_list.append(f"{desc}")
            tooth_info.append(f"  Anomalies: {', '.join(anomaly_list)}")
        procedures = tooth.get("procedures", [])
        if procedures:
            proc_list = [proc.get("description", "") for proc in procedures]
            tooth_info.append(f"  Procedures: {', '.join(proc_list)}")
        foreign_objects = tooth.get("foreign_objects", [])
        if foreign_objects:
            foreign_list = [obj.get("description", "") for obj in foreign_objects]
            tooth_info.append(f"  Foreign Objects: {', '.join(foreign_list)}")
        if len(tooth_info) > 1:
            parts.append("\n".join(tooth_info))
    return "\n\n".join(parts)

### SIMPLIFIED CHAT FUNCTION (NO SQL) ###
def enhanced_chat_with_medbot(
    question: str,
    chat_history: List[Tuple[str, str]],
    session_id: str,
    current_thread_data: Optional[dict] = None,
    current_patient_id: Optional[str] = None,
    patient_name: Optional[str] = None,
    patient_history: Optional[List[dict]] = None
) -> Tuple[str, List[Tuple[str, str]]]:
    """
    Enhanced chat function that works with data passed directly from MongoDB
    """
    current_thread = session_state.get_current_thread(session_id)
    if not current_thread:
        return "", chat_history
    
    # Update thread data if provided
    if current_thread_data:
        current_thread.update(current_thread_data)
    
    # Update session patient info if provided
    session = session_state.get_session(session_id)
    if current_patient_id and patient_name:
        session_state.set_current_patient(session_id, current_patient_id, patient_name, patient_history)

    # Get patient context
    patient_context = session_state.get_patient_context(session_id)

    # ===== 1. CHECK IF USER EXPLICITLY REQUESTS PAST JSONS =====
    history_keywords = ["full history", "all past data", "complete json history", "raw visit data"]
    is_history_request = any(keyword in question.lower() for keyword in history_keywords)
    
    if is_history_request:
        history = session.get('patient_history', [])
        if not history:
            response = "No past visit data available."
            chat_history.append((question, response))
            return "", chat_history
        
        prompt = f"""
You are DentalMed AI. The user requested FULL PAST JSON DATA for analysis.

**PATIENT**: {session['patient_name']}
**TOTAL VISITS**: {len(history)}

**INSTRUCTIONS**:
1. Provide a structured overview of ALL raw JSON visits
2. Highlight key changes in anomalies/procedures
3. Do NOT summarize - show exact data differences

**FULL VISIT DATA**:
{json.dumps(history, indent=2)}

**Question**: {question}

Response:
"""
        try:
            response = llm.invoke(prompt)
            chat_history.append((question, response))
            return "", chat_history
        except Exception as e:
            error_response = f"⚠️ Error loading full history: {str(e)}"
            chat_history.append((question, error_response))
            return "", chat_history

    # ===== 2. VISIT COMPARISON PROMPT =====
    comparison_keywords = ["compare visits", "visit comparison", "changes since", "progression", "compare findings"]
    is_comparison_request = any(keyword in question.lower() for keyword in comparison_keywords)
    
    if is_comparison_request:
        comparison_data = session_state.get_visit_comparison_data(session_id)
        if isinstance(comparison_data, str):
            response = f"❌ {comparison_data}"
            chat_history.append((question, response))
            return "", chat_history
        
        prompt = f"""
You are DentalMed AI. Analyze and compare multiple visits for this patient.

**PATIENT**: {comparison_data['patient_name']}
**VISITS TO COMPARE**: {len(comparison_data['visits'])} visits

**COMPARISON ANALYSIS REQUIRED**:
1. **New Findings**: What appeared in recent visits that wasn't present before?
2. **Resolved Issues**: What findings from earlier visits are no longer present?
3. **Progression**: How have existing conditions changed over time?
4. **Treatment Effectiveness**: Based on findings, how effective were previous treatments?
5. **Risk Assessment**: What patterns suggest increased/decreased risk?

**VISIT DATA**:
{json.dumps(comparison_data, indent=2)}

**FORMAT YOUR RESPONSE AS**:

## 📊 Visit Comparison Analysis

### 🆕 New Findings
- [List new findings with dates they first appeared]

### ✅ Resolved Issues  
- [List findings that are no longer present]

### 📈 Condition Progression
- [Track how conditions changed over time]

### 🎯 Treatment Effectiveness
- [Analyze treatment outcomes based on findings]

### ⚠️ Clinical Recommendations
- [Based on patterns, what should be monitored/treated]

**Your Question**: {question}

Response:
"""
        try:
            response = llm.invoke(prompt)
            if "Response:" in response:
                response = response.split("Response:")[-1].strip()
        except Exception as e:
            response = f"⚠️ Error generating comparison: {str(e)}"
        chat_history.append((question, response))
        return "", chat_history

    # ===== 3. GENERAL DENTAL QUESTIONS (NO JSONs) =====
    general_dental_keywords = ["what is", "how to", "explain", "difference between", "standard treatment"]
    is_general_question = any(keyword in question.lower() for keyword in general_dental_keywords)
    
    if is_general_question and current_thread['json_context'] is None:
        prompt = f"""
You are DentalMed AI, an expert dental assistant with comprehensive knowledge of:
- Dental procedures and terminology
- CDT codes and their applications
- Common dental conditions and treatments
- Best practices in dentistry

{patient_context if patient_context else ""}

Please provide a professional response to this question:

Question: {question}

Guidelines:
1. Be accurate and cite sources if possible
2. Use simple language for patient questions
3. Include relevant CDT codes when appropriate
4. For treatment questions, mention alternatives
5. Keep responses under 200 words unless complex

Response:
"""
        try:
            response = llm.invoke(prompt)
            chat_history.append((question, response))
            return "", chat_history
        except Exception as e:
            error_response = f"⚠️ Error answering general question: {str(e)}"
            chat_history.append((question, error_response))
            return "", chat_history

    # ===== 4. TREATMENT PLAN (CURRENT JSON ONLY) =====
    is_treatment_plan_request = any(keyword in question.lower() for keyword in 
                                  ["treatment plan", "create treatment", "treatment recommendation", 
                                   "cdt codes", "treatment codes"])
    
    if is_treatment_plan_request:
        current_case_context = current_thread['json_context']
        prompt = f"""
You are MedBot, a precise dental assistant AI. Create a treatment plan ONLY for teeth with anomaly metadata.

**STRICT INSTRUCTIONS**:
1. ONLY include teeth where anomalies have metadata (ignore others)
2. For each finding, provide:
   - Tooth number
   - Exact description from metadata
   - Recommended CDT code(s)
3. Format as a clean table
4. Never invent data - skip if no metadata exists
5. If no CDT code is found, write: "No matching CDT code found."
6. Provide ONLY the most clinically appropriate codes, not all possibilities.

**Teeth with Metadata**:
{current_thread['cdt_matches'] if current_thread['cdt_matches'] else "No teeth with metadata found"}

**Output Format**:
| Tooth | Finding Description | Metadata | Recommended CDT Codes |
|-------|---------------------|----------|-----------------------|
| ...   | ...                 | ...      | ...                   |

**Formatting Requirements**:
1. Keep each cell content SHORT and concise
2. Break long descriptions into key points only  
3. Each row should fit on one line

**REMEMBER**: You are making clinical decisions - choose the most appropriate treatment.

**Current Dental Case ONLY**:
{current_case_context}

**Available CDT Codes for Anomalies with Metadata**:
{current_thread['cdt_matches']}

**Your Request**: {question}

Answer:
"""
        if current_thread['findings']:
            _, output_records = format_finding_matches(current_thread['findings'])
            if output_records:
                save_results_to_excel(output_records)

    # ===== 5. DEFAULT PATIENT-SPECIFIC PROMPT =====
    else:
        prompt = f"""
You are DentalMed AI, a knowledgeable dental assistant AI with access to comprehensive patient information.

You have been provided with:
1. Complete dental case information including all teeth, anomalies, procedures, and foreign objects
2. Relevant CDT codes for anomalies that have metadata

**PATIENT HISTORY (SUMMARY)**:
{patient_context}

**CURRENT VISIT**:
{current_thread['json_context']}

**Available CDT Treatment Codes**:
{current_thread['cdt_matches']}

**Question**: {question}

Instructions:
- Use patient history to provide informed responses
- Reference previous visits when relevant
- Note any patterns or changes over time
- Provide continuity of care recommendations

**Response**:
"""
    
    try:
        response = llm.invoke(prompt)
        if "Answer:" in response:
            response = response.split("Answer:")[-1].strip()
        elif "Response:" in response:
            response = response.split("Response:")[-1].strip()
        
        chat_history.append((question, response))
        current_thread['chat_history'] = chat_history
            
    except Exception as e:
        error_response = f"⚠️ Error processing your question: {str(e)}"
        print(str(e))
        chat_history.append((question, error_response))
        current_thread['chat_history'] = chat_history
    
    return "", chat_history


def handle_json_text_input(json_text, chat_history, session_id):
    """Handle JSON input - expects dict or string"""
    current_thread = session_state.get_current_thread(session_id)
    session = session_state.get_session(session_id)
    
    if current_thread is None:
        return chat_history, json_text
    
    try:
        if not json_text:
            raise ValueError("No JSON content provided")
            
        # Handle both dict and string inputs
        if isinstance(json_text, str):
            data = json.loads(json_text)
        else:
            data = json_text
        
        # Store data in the CURRENT THREAD only
        current_thread['json_context'] = json_to_full_text(data)
        current_thread['findings'] = extract_anomalies(data)
        current_thread['json_text'] = json.dumps(data) if isinstance(json_text, dict) else json_text
        
        if current_thread['findings']:
            current_thread['cdt_matches'], _ = format_finding_matches(current_thread['findings'])
            context_message = f"✅ Patient data loaded in case '{current_thread['name']}'\nFound {len(current_thread['findings'])} anomalies with metadata."
        else:
            current_thread['cdt_matches'] = "No anomalies with metadata."
            context_message = f"✅ Patient data loaded in case '{current_thread['name']}'\nNo anomalies with metadata found."
        
        chat_history.append(("System", context_message))
        current_thread['chat_history'] = chat_history
        
        return chat_history, current_thread['json_text']
        
    except json.JSONDecodeError:
        chat_history.append(("Error", "⚠️ Invalid JSON syntax."))
        return chat_history, json_text
    except Exception as e:
        chat_history.append(("Error", f"⚠️ Error: {str(e)}"))
        return chat_history, json_text

def select_patient_with_persistence(patient_input, session_id, patient_history=None):
    """Handle patient selection with in-memory persistence"""
    if not patient_input.strip():
        return "Please enter a patient name or ID", []
    
    # Create patient ID from input
    patient_id = patient_input.strip().replace(" ", "_").lower()
    
    # Set patient in session with optional history
    visit_count = session_state.set_current_patient(session_id, patient_id, patient_input, patient_history)
    
    message = f"✅ Selected patient: {patient_input} (ID: {patient_id})"
    
    if patient_history:
        message += f"\n📋 Total visits: {len(patient_history)}"
        
        # Show history summary in chat
        history_summary = f"\n\n📋 Recent Visits:\n"
        for i, visit in enumerate(patient_history[:3]):  # Show last 3 visits
            visit_date = visit.get('timestamp', 'Unknown date')
            findings_count = len(visit.get('findings', []))
            history_summary += f"• Visit {i+1}: {visit_date} - {findings_count} findings\n"
        message += history_summary
    else:
        message += "\n📋 New patient - No previous visits"
    
    chat_history = [("System", message)]
    return message, chat_history

