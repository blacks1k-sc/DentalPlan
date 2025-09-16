import json
import os
import time
import random
import pandas as pd
from ollama_embedder import CDTEmbedder
from langchain_community.llms import Ollama
from langchain_core.prompts import PromptTemplate
from langchain.chains import LLMChain
from uuid import uuid4
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Union
import ollama

# Load LLaMA model via Ollama
llm = Ollama(model="mistral:latest")
print("✅ (Ollama) model loaded.")

# Typing speed configuration (characters per second)
TYPING_SPEED = 30  # Adjust this: 20 = slow, 30 = medium, 50 = fast
TYPING_DELAY = 1.0 / TYPING_SPEED  # Convert to delay per character

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

def format_chat_history(chat_history):
    """Format chat history for LLM prompt"""
    if not chat_history:
        return "No previous conversation history."
    
    formatted_history = []
    for i, (role, message) in enumerate(chat_history):
        if role == "user":
            formatted_history.append(f"User: {message}")
        elif role == "assistant":
            formatted_history.append(f"Assistant: {message}")
        elif role == "system":
            formatted_history.append(f"System: {message}")
        else:
            formatted_history.append(f"{role.title()}: {message}")
    
    return "\n".join(formatted_history)

def transform_anomalies_for_llm(data, confidence_threshold=0.50):
    """
    Transform CV anomalies with confidence filtering and grouped labels for LLM processing.
    
    Args:
        data: The transformed annotation data from backend
        confidence_threshold: Minimum confidence score (default 0.50)
    
    Returns:
        dict: Processed anomalies with grouped labels and confidence filtering
    """
    try:
        # Initialize result structure
        result = {
            "anomalies_grouped": [],
            "suspected_anomalies": [],
            "confidence_threshold": confidence_threshold,
            "total_anomalies": 0,
            "filtered_anomalies": 0
        }
        
        # Handle new comprehensive data structure
        if "current_visit" in data:
            current_visit = data["current_visit"]
            anomalies_data = current_visit.get("anomalies", {}).get("teeth", [])
        # Handle legacy data structure
        elif "teeth" in data:
            anomalies_data = data.get("teeth", [])
        else:
            return result
        
        # Group anomalies by type and tooth ranges
        anomaly_groups = {}
        suspected_anomalies = []
        
        for tooth_data in anomalies_data:
            tooth_number = tooth_data.get('number', 'unknown')
            anomalies = tooth_data.get("anomalies", [])
            
            for anomaly in anomalies:
                description = anomaly.get("description", "")
                metadata = anomaly.get("metadata", {})
                confidence = metadata.get("confidence", 0.0)
                
                result["total_anomalies"] += 1
                
                # Apply confidence filter
                if confidence >= confidence_threshold:
                    result["filtered_anomalies"] += 1
                    
                    # Create grouped label for unknown tooth numbers
                    if tooth_number == 'unknown' or tooth_number is None:
                        # Group by anomaly type for unknown teeth
                        if description not in anomaly_groups:
                            anomaly_groups[description] = {
                                "label": f"{description} [Unknown Location]",
                                "teeth": [],
                                "confidence": confidence,
                                "count": 0
                            }
                        anomaly_groups[description]["count"] += 1
                        anomaly_groups[description]["confidence"] = max(
                            anomaly_groups[description]["confidence"], 
                            confidence
                        )
                    else:
                        # Handle known tooth numbers
                        if description not in anomaly_groups:
                            anomaly_groups[description] = {
                                "label": description,
                                "teeth": [],
                                "confidence": confidence,
                                "count": 0
                            }
                        
                        # Add tooth to the group
                        if tooth_number not in anomaly_groups[description]["teeth"]:
                            anomaly_groups[description]["teeth"].append(tooth_number)
                        
                        anomaly_groups[description]["count"] += 1
                        anomaly_groups[description]["confidence"] = max(
                            anomaly_groups[description]["confidence"], 
                            confidence
                        )
                else:
                    # Add to suspected anomalies (below threshold)
                    suspected_anomalies.append({
                        "description": description,
                        "tooth": tooth_number,
                        "confidence": confidence,
                        "metadata": metadata
                    })
        
        # Convert grouped anomalies to final format
        for description, group_data in anomaly_groups.items():
            # Create final label with tooth ranges
            if group_data["teeth"]:
                # Sort teeth and create ranges
                sorted_teeth = sorted([int(t) for t in group_data["teeth"] if str(t).isdigit()])
                if sorted_teeth:
                    # Create ranges for consecutive teeth
                    ranges = []
                    start = sorted_teeth[0]
                    end = start
                    
                    for i in range(1, len(sorted_teeth)):
                        if sorted_teeth[i] == end + 1:
                            end = sorted_teeth[i]
                        else:
                            if start == end:
                                ranges.append(str(start))
                            else:
                                ranges.append(f"{start}–{end}")
                            start = sorted_teeth[i]
                            end = start
                    
                    # Add the last range
                    if start == end:
                        ranges.append(str(start))
                    else:
                        ranges.append(f"{start}–{end}")
                    
                    final_label = f"{description} [{', '.join(ranges)}]"
                else:
                    final_label = f"{description} [Unknown Location]"
            else:
                final_label = f"{description} [Unknown Location]"
            
            result["anomalies_grouped"].append({
                "label": final_label,
                "description": description,
                "confidence": group_data["confidence"],
                "count": group_data["count"],
                "teeth": group_data["teeth"]
            })
        
        # Create by-tooth detailed list for non-bone-loss anomalies
        by_tooth_details = []
        for description, group_data in anomaly_groups.items():
            if not description.lower().find("bone loss") != -1 and group_data["teeth"]:
                for tooth in sorted(group_data["teeth"]):
                    by_tooth_details.append(f"{description} on {tooth}")
        
        result["anomalies_by_tooth"] = by_tooth_details
        
        # Add suspected anomalies
        result["suspected_anomalies"] = suspected_anomalies
        
        return result
        
    except Exception as e:
        print(f"Error in transform_anomalies_for_llm: {str(e)}")
        return {
            "anomalies_grouped": [],
            "suspected_anomalies": [],
            "confidence_threshold": confidence_threshold,
            "total_anomalies": 0,
            "filtered_anomalies": 0,
            "error": str(e)
        }

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
    """Convert comprehensive JSON structure to text context with clear separation"""
    parts = []
    
    # Handle new comprehensive data structure
    if "current_visit" in data:
        current_visit = data["current_visit"]
        
        # Process grouped anomalies first (if available)
        if "anomalies_grouped" in data and data["anomalies_grouped"]:
            parts.append("**CURRENT VISIT ANOMALIES (GROUPED):**")
            for anomaly in data["anomalies_grouped"]:
                label = anomaly.get("label", "")
                confidence = anomaly.get("confidence", 0.0)
                count = anomaly.get("count", 1)
                if count > 1:
                    parts.append(f"• {label} (confidence: {confidence:.2f}, count: {count})")
                else:
                    parts.append(f"• {label} (confidence: {confidence:.2f})")
        
        # Process suspected anomalies (below confidence threshold)
        if "suspected_anomalies" in data and data["suspected_anomalies"]:
            parts.append("**SUSPECTED ANOMALIES (LOW CONFIDENCE):**")
            for anomaly in data["suspected_anomalies"]:
                desc = anomaly.get("description", "")
                tooth = anomaly.get("tooth", "Unknown")
                confidence = anomaly.get("confidence", 0.0)
                parts.append(f"• {desc} on Tooth {tooth} (confidence: {confidence:.2f})")
        
        # Fallback to original anomaly processing if no grouped anomalies
        if not data.get("anomalies_grouped"):
            anomaly_parts = []
            if "anomalies" in current_visit and "teeth" in current_visit["anomalies"]:
                for tooth in current_visit["anomalies"]["teeth"]:
                    number = tooth.get('number', 'Unknown')
                    anomalies = tooth.get("anomalies", [])
                    if anomalies:
                        anomaly_list = []
                        for anom in anomalies:
                            desc = anom.get("description", "")
                            metadata = anom.get("metadata", {})
                            confidence = metadata.get("confidence", "")
                            if confidence:
                                anomaly_list.append(f"{desc} (confidence: {confidence:.2f})")
                            else:
                                anomaly_list.append(f"{desc}")
                        anomaly_parts.append(f"Tooth {number}: {', '.join(anomaly_list)}")
            
            if anomaly_parts:
                parts.append("**CURRENT VISIT ANOMALIES:**")
                parts.extend(anomaly_parts)
        
        # Process procedures
        procedure_parts = []
        if "procedures" in current_visit and "teeth" in current_visit["procedures"]:
            for tooth in current_visit["procedures"]["teeth"]:
                number = tooth.get('number', 'Unknown')
                procedures = tooth.get("procedures", [])
                if procedures:
                    proc_list = []
                    for proc in procedures:
                        desc = proc.get("description", "")
                        metadata = proc.get("metadata", {})
                        confidence = metadata.get("confidence", "")
                        if confidence:
                            proc_list.append(f"{desc} (confidence: {confidence:.2f})")
                        else:
                            proc_list.append(f"{desc}")
                    procedure_parts.append(f"Tooth {number}: {', '.join(proc_list)}")
        
        # Process foreign objects
        foreign_object_parts = []
        if "foreign_objects" in current_visit and "teeth" in current_visit["foreign_objects"]:
            for tooth in current_visit["foreign_objects"]["teeth"]:
                number = tooth.get('number', 'Unknown')
                foreign_objects = tooth.get("foreign_objects", [])
                if foreign_objects:
                    foreign_list = []
                    for obj in foreign_objects:
                        desc = obj.get("description", "")
                        metadata = obj.get("metadata", {})
                        confidence = metadata.get("confidence", "")
                        if confidence:
                            foreign_list.append(f"{desc} (confidence: {confidence:.2f})")
                        else:
                            foreign_list.append(f"{desc}")
                    foreign_object_parts.append(f"Tooth {number}: {', '.join(foreign_list)}")
        
        # Format with clear sections
        if procedure_parts:
            parts.append("**CURRENT VISIT PROCEDURES:**")
            parts.extend(procedure_parts)
        
        if foreign_object_parts:
            parts.append("**CURRENT VISIT FOREIGN OBJECTS:**")
            parts.extend(foreign_object_parts)
    
    # Handle legacy data structure for backward compatibility
    elif "teeth" in data:
        if "imagePath" in data:
            parts.append(f"Image: {data['imagePath']} ({data['imageWidth']}x{data['imageHeight']})")
        
        anomaly_parts = []
        procedure_parts = []
        foreign_object_parts = []
        
        for tooth in data.get("teeth", []):
            number = tooth['number']
            
            # Process anomalies
            anomalies = tooth.get("anomalies", [])
            if anomalies:
                anomaly_list = []
                for anom in anomalies:
                    desc = anom.get("description", "")
                    metadata = anom.get("metadata", {})
                    confidence = metadata.get("confidence", "")
                    if confidence:
                        anomaly_list.append(f"{desc} (confidence: {confidence:.2f})")
                    else:
                        anomaly_list.append(f"{desc}")
                anomaly_parts.append(f"Tooth {number}: {', '.join(anomaly_list)}")
            
            # Process procedures
            procedures = tooth.get("procedures", [])
            if procedures:
                proc_list = [proc.get("description", "") for proc in procedures]
                procedure_parts.append(f"Tooth {number}: {', '.join(proc_list)}")
            
            # Process foreign objects
            foreign_objects = tooth.get("foreign_objects", [])
            if foreign_objects:
                foreign_list = [obj.get("description", "") for obj in foreign_objects]
                foreign_object_parts.append(f"Tooth {number}: {', '.join(foreign_list)}")
        
        # Format with clear sections
        if anomaly_parts:
            parts.append("**CURRENT ANOMALIES:**")
            parts.extend(anomaly_parts)
        
        if procedure_parts:
            parts.append("**CURRENT PROCEDURES:**")
            parts.extend(procedure_parts)
        
        if foreign_object_parts:
            parts.append("**FOREIGN OBJECTS:**")
            parts.extend(foreign_object_parts)
    
    return "\n".join(parts) if parts else "No dental findings detected"

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
        # Parse current visit data to separate anomalies from procedures
        current_data = current_thread.get('json_context', '')
        current_anomalies = []
        current_procedures = []
        
        # Extract current visit anomalies and procedures from json_context
        if current_data:
            try:
                import json
                # Try to parse the json_context if it's JSON format
                if current_data.strip().startswith('{'):
                    parsed_data = json.loads(current_data)
                    for tooth in parsed_data.get('teeth', []):
                        tooth_num = tooth.get('number', 'Unknown')
                        for anomaly in tooth.get('anomalies', []):
                            current_anomalies.append(f"Tooth {tooth_num}: {anomaly.get('description', 'Unknown anomaly')}")
                        for procedure in tooth.get('procedures', []):
                            current_procedures.append(f"Tooth {tooth_num}: {procedure.get('description', 'Unknown procedure')}")
                else:
                    # If it's text format, extract anomalies and procedures
                    lines = current_data.split('\n')
                    for line in lines:
                        if 'Anomalies:' in line:
                            current_anomalies.append(line.strip())
                        elif 'Procedures:' in line:
                            current_procedures.append(line.strip())
            except:
                # Fallback: treat entire context as anomalies if parsing fails
                current_anomalies = [current_data] if current_data else []
        
        # Format the data sections
        current_anomalies_text = "\n".join(current_anomalies) if current_anomalies else "No current anomalies detected"
        current_procedures_text = "\n".join(current_procedures) if current_procedures else "No current procedures listed"
        
        prompt = f"""
You are DentalMed AI, a knowledgeable dental assistant AI with comprehensive access to patient information.

**COMPREHENSIVE DATA AWARENESS:**
You have access to multiple types of patient data. It is ESSENTIAL that you understand and appropriately respond to questions about any of these data types:

1. **CURRENT VISIT ANOMALIES** = New findings from today's X-ray analysis (conditions requiring attention)
2. **CURRENT VISIT PROCEDURES** = Procedures performed during current visit (treatments done today)
3. **CURRENT VISIT FOREIGN OBJECTS** = Orthodontic appliances, implants, etc. detected in current visit
4. **PATIENT HISTORY** = Historical data from previous visits (past findings and treatments)

**CURRENT VISIT DATA:**
{current_thread['json_context']}

**PATIENT HISTORY** (Previous visits and treatments):
{patient_context}

**Available CDT Treatment Codes**:
{current_thread['cdt_matches']}

**Question**: {question}

**CRITICAL: COMPREHENSIVE ANOMALY REPORTING**
Regardless of the question type, you MUST ALWAYS:
1. **FIRST**: Report ALL detected anomalies from the current visit data
2. **THEN**: Provide your specific response to the question
3. **NEVER**: Filter, omit, or selectively report anomalies based on question type

**INTELLIGENT RESPONSE GUIDELINES:**
You are now comprehensively aware of ALL patient data. Respond intelligently to ANY question type:

**For Anomaly Questions** ("what are the anomalies?", "what problems do you see?"):
- Focus on CURRENT VISIT ANOMALIES only
- Provide specific details about each anomaly
- Suggest appropriate treatment options

**For Procedure Questions** ("what procedures were done?", "what treatments exist?"):
- Distinguish between current visit procedures vs historical procedures
- Provide details about each procedure type and location

**For Foreign Object Questions** ("what appliances are present?", "what orthodontic work?"):
- Reference CURRENT VISIT FOREIGN OBJECTS
- Explain the purpose and implications of each object

**For General Questions** ("what do you see?", "summarize the findings"):
- Provide a comprehensive overview of ALL current visit data
- Organize by data type (anomalies, procedures, foreign objects)
- Include relevant historical context

**For Treatment Planning Questions** ("what should be done?", "recommendations?", "generate a treatment plan"):
- **CRITICAL**: Report ALL CURRENT VISIT ANOMALIES first
- Then consider ALL current findings (anomalies, procedures, foreign objects)
- Provide evidence-based treatment recommendations for EACH finding
- Reference appropriate CDT codes for EACH anomaly

**For Comparison Questions** ("how has this changed?", "compare with previous visits"):
- Use both current visit data and patient history
- Highlight changes, improvements, or new concerns

**MANDATORY FORMAT FOR ALL RESPONSES:**
1. **ANOMALIES DETECTED**: List ALL anomalies found in current visit
2. **SPECIFIC RESPONSE**: Answer the user's question based on ALL findings
3. **COMPREHENSIVE COVERAGE**: Ensure no findings are omitted

**Always:**
- Be specific about tooth numbers and conditions
- Include confidence levels when available
- Provide evidence-based recommendations
- Maintain professional dental terminology
- **NEVER filter or omit any detected anomalies**

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


### STREAMING CHAT FUNCTION ###
def enhanced_chat_with_medbot_stream(
    question: str,
    chat_history: List[Tuple[str, str]],
    session_id: str,
    current_thread_data: Optional[dict] = None,
    current_patient_id: Optional[str] = None,
    patient_name: Optional[str] = None,
    patient_history: Optional[List[dict]] = None
):
    """
    Streaming version of enhanced_chat_with_medbot that yields text chunks
    """
    current_thread = session_state.get_current_thread(session_id)
    if not current_thread:
        yield "Error: No session found"
        return
    
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
            yield "No past visit data available."
            return
        
        prompt = f"""
You are DentalMed AI. The user requested FULL PAST JSON DATA for analysis.

**PATIENT**: {session['patient_name']}
**TOTAL VISITS**: {len(history)}

**INSTRUCTIONS**:
1. Provide a structured overview of ALL raw JSON visits
2. Highlight key changes in anomalies/procedures
3. Do NOT summarize - show exact data differences
4. Include visit dates and patient progression
5. Format as organized sections per visit

**ALL VISIT DATA**:
{json.dumps(history, indent=2)}

**Question**: {question}

**Response**:
"""
        try:
            # Use direct Ollama client for streaming
            stream = ollama.chat(
                model='mistral:latest',
                messages=[{'role': 'user', 'content': prompt}],
                stream=True
            )
            
            for chunk in stream:
                if chunk.get('message', {}).get('content'):
                    content = chunk['message']['content']
                    # Yield content directly for real-time streaming
                    yield content
            return
        except Exception as e:
            yield f"⚠️ Error processing history request: {str(e)}"
            return

    # ===== 2. GENERAL DENTAL QUESTIONS (NO JSONs) =====
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
            # Use direct Ollama client for streaming
            stream = ollama.chat(
                model='mistral:latest',
                messages=[{'role': 'user', 'content': prompt}],
                stream=True
            )
            
            for chunk in stream:
                if chunk.get('message', {}).get('content'):
                    content = chunk['message']['content']
                    # Yield content directly for real-time streaming
                    yield content
            return
        except Exception as e:
            yield f"⚠️ Error answering general question: {str(e)}"
            return

    # ===== 3. TREATMENT PLAN (CURRENT JSON ONLY) =====
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
        try:
            # Use direct Ollama client for streaming
            stream = ollama.chat(
                model='mistral:latest',
                messages=[{'role': 'user', 'content': prompt}],
                stream=True
            )
            
            for chunk in stream:
                if chunk.get('message', {}).get('content'):
                    content = chunk['message']['content']
                    # Yield content directly for real-time streaming
                    yield content
            return
        except Exception as e:
            yield f"⚠️ Error creating treatment plan: {str(e)}"
            return

    # ===== 4. COMPREHENSIVE ANALYSIS (CURRENT + HISTORY) =====
    current_case_context = current_thread['json_context']
    patient_history_context = session.get('patient_history', [])
    
    # Debug: Print what data is being sent to LLM
    print(f"🔍 DEBUG: current_case_context type: {type(current_case_context)}")
    print(f"🔍 DEBUG: current_case_context content: {current_case_context}")
    print(f"🔍 DEBUG: patient_history_context length: {len(patient_history_context)}")
    print(f"🔍 DEBUG: Question: {question}")
    
    prompt = f"""
You are DentalMed AI, a knowledgeable dental assistant AI with comprehensive access to patient information.

**COMPREHENSIVE DATA AWARENESS:**
You have access to multiple types of patient data. It is ESSENTIAL that you understand and appropriately respond to questions about any of these data types:

1. **CURRENT VISIT ANOMALIES** = New findings from today's X-ray analysis (conditions requiring attention)
2. **CURRENT VISIT PROCEDURES** = Procedures performed during current visit (treatments done today)
3. **CURRENT VISIT FOREIGN OBJECTS** = Orthodontic appliances, implants, etc. detected in current visit
4. **PATIENT HISTORY** = Historical data from previous visits (past findings and treatments)

**CURRENT VISIT DATA:**
{current_case_context}

**PATIENT HISTORY** (Previous visits and treatments):
{patient_context}

**Available CDT Treatment Codes**:
{current_thread['cdt_matches']}

**Question**: {question}

**CRITICAL: COMPREHENSIVE ANOMALY REPORTING**
Regardless of the question type, you MUST ALWAYS:
1. **FIRST**: Report ALL detected anomalies from the current visit data
2. **THEN**: Provide your specific response to the question
3. **NEVER**: Filter, omit, or selectively report anomalies based on question type

**INTELLIGENT RESPONSE GUIDELINES:**
You are now comprehensively aware of ALL patient data. Respond intelligently to ANY question type:

**For Anomaly Questions** ("what are the anomalies?", "what problems do you see?"):
- Focus on CURRENT VISIT ANOMALIES only
- Provide specific details about each anomaly
- Suggest appropriate treatment options

**For Procedure Questions** ("what procedures were done?", "what treatments exist?"):
- Distinguish between current visit procedures vs historical procedures
- Provide details about each procedure type and location

**For Foreign Object Questions** ("what appliances are present?", "what orthodontic work?"):
- Reference CURRENT VISIT FOREIGN OBJECTS
- Explain the purpose and implications of each object

**For General Questions** ("what do you see?", "summarize the findings"):
- Provide a comprehensive overview of ALL current visit data
- Organize by data type (anomalies, procedures, foreign objects)
- Include relevant historical context

**For Treatment Planning Questions** ("what should be done?", "recommendations?", "generate a treatment plan"):
- **CRITICAL**: Report ALL CURRENT VISIT ANOMALIES first
- Then consider ALL current findings (anomalies, procedures, foreign objects)
- Provide evidence-based treatment recommendations for EACH finding
- Reference appropriate CDT codes for EACH anomaly

**For Comparison Questions** ("how has this changed?", "compare with previous visits"):
- Use both current visit data and patient history
- Highlight changes, improvements, or new concerns

**MANDATORY FORMAT FOR ALL RESPONSES:**
1. **ANOMALIES DETECTED**: List ALL anomalies found in current visit
2. **SPECIFIC RESPONSE**: Answer the user's question based on ALL findings
3. **COMPREHENSIVE COVERAGE**: Ensure no findings are omitted

**Always:**
- Be specific about tooth numbers and conditions
- Include confidence levels when available
- Provide evidence-based recommendations
- Maintain professional dental terminology
- **NEVER filter or omit any detected anomalies**

**Response**:
"""
    
    try:
        print(f"Starting LLM stream for comprehensive analysis")
        chunk_count = 0
        
        # Use direct Ollama client for streaming
        stream = ollama.chat(
            model='mistral:latest',
            messages=[{'role': 'user', 'content': prompt}],
            stream=True
        )
        
        for chunk in stream:
            if chunk.get('message', {}).get('content'):
                content = chunk['message']['content']
                chunk_count += 1
                print(f"LLM chunk {chunk_count}: {content[:30]}...")
                
                # Yield content directly for real-time streaming (no artificial delays)
                yield content
        
        print(f"LLM streaming completed. Total chunks: {chunk_count}")
    except Exception as e:
        print(f"LLM streaming error: {str(e)}")
        yield f"⚠️ Error processing your question: {str(e)}"


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

