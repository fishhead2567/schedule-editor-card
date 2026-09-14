// Single bundle entry so both cards ship as one HACS "plugin" resource -
// keeps packaging/install unchanged (one hacs.json filename, one Lovelace
// resource) even though the repo now provides two custom elements.
import "./schedule-editor-card";
import "./schedule-timeline-card";
