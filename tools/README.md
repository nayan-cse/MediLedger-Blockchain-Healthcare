# Optional document-generation tools

These scripts are not required to run the healthcare application.

`build_report.py` reads the measured JSON evidence and generates the report PDF and latency chart. It requires Python with `reportlab`, `matplotlib` and `Pillow`, and DejaVu fonts at `/usr/share/fonts/truetype/dejavu` (change FONTDIR for another system).

`build_video.py` reads the same measured data and the scripted demonstration evidence. It requires Pillow and ffmpeg with its `flite` speech-synthesis filter. It generates the timed Markdown script and a 1280x720 H.264/AAC narrated video. The original uses the `slt` synthetic voice. To present in your own voice, record the supplied script while demonstrating the local application.

The submitted files have already been rendered and visually checked. Rebuilding after changing the benchmark evidence updates the displayed values. Check the report page count and final video duration again after any edits.
