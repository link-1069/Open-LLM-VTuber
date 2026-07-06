# Electron Loads The External H5 Entry Page

Electron starts by loading `http://localhost:8500/static/h5.html` instead of the bundled chromakey renderer window. The external H5 page owns the start button, WHEP playback, recording iframe, and chromakey renderer, so opening the bundled renderer first would start a second digital-human flow and make the green-screen behavior happen before the user explicitly enters the experience.
