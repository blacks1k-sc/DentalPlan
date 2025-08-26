// constants.js
export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 600;
export const desiredOrder = ['Dental Chart', 'Anomaly', 'Procedure', 'Foreign Object', 'Landmark', 'Others'];
export const labelColors = {
  'A': 'red',
  'B': 'blue',
  'C': 'green',
  'Line': 'purple',
  'Caries': 'yellow',
  'Crown': 'grey',
  'Filling': 'silver',
  'Implant': 'gold',
  'Malaligned': 'maroon',
  'Mandibular Canal': 'cyan',
  'Missing teeth': 'light green',
  'Pariapical lesion': 'orange',
  'Retained root': 'brown',
  'Root Canal Treatment': 'magenta',
  'Root Piece': 'teal',
  'croen': 'pink',
  'impacted tooth': 'navy',
  'maxillary sinus': 'olive',
};
export const MAX_HISTORY = 50;
export const STATUS_OPTIONS = [
  'OPEN',
  'In-Progress',
  'Ready for Review',
  'Reviewed',
  'Complete',
  'Signed Off'
];

export const groupNames = {
  "Foreign Object":"Foreign Objects",
  "Anomaly":"Anomalies",
  "Landmark":"Landmarks",
  "Procedure":"Existing Procedures",
  "Dental Chart":"Dental Chart",
  "Others":"Others"
}