# Germinator AI 🌱

**Germinator AI** is a professional, browser-native seed germination analysis tool. It processes time-lapse images of germinating seeds and automatically scores germination onset times, extracts morphological features, and fits standard germination curves (like the 4-parameter Hill function). 

This project is a JavaScript/WebAssembly port of the original Python [GERMINATOR](https://doi.org/10.1111/j.1365-313X.2010.04236.x) package (Joosen et al., 2010), completely modernized and designed to run entirely locally in your browser with zero server-side processing.

It is part of the **CoSE AstroBotany suite**.

## Features

- **No Server Required:** All image processing and analysis runs locally in your browser. Your data never leaves your computer.
- **Support for ZIP archives:** Simply drag and drop a `.zip` file containing your time-lapse image series.
- **Automated Pipeline:** 
  1. Segmentation (Background removal)
  2. Auto-calibration
  3. Frame Registration (handles camera bumps)
  4. Geodesic Seed Tracking
  5. Absorbing-state Germination Scoring
- **Interactive UI:** Scrub through the timeline and view a color-coded seed map overlay showing the germination status of every seed in real-time.
- **Export:** Export germination times and curve parameters to CSV or JSON.
- **CoSE Theme:** Clean, modern, scientific design system with native Light and Dark modes.

## Quick Start (Demo)

You don't need any data to try out the tool!
1. Open the application.
2. Click **Load Demo Dataset (Arabidopsis)**.
3. The app will generate a synthetic time-series of Arabidopsis seeds, process them through the pipeline, and render the resulting germination curve and interactive seed map.

## Benchmark Datasets

Looking for real data to test the software? We recommend the following open-access datasets:
- **SPIRO Assays** (Arabidopsis) - [GitHub](https://github.com/jiaxuanleong/SPIRO.Assays)
- **ChronoRoot** (Arabidopsis) - [GigaDB](https://doi.org/10.5524/100911)
- **SeedGerm-VIG** (Wheat/Barley) - [BioImage Archive](https://www.ebi.ac.uk/biostudies/studies/S-BIAD1852)

## Architecture

- `index.html` - Single Page Application entry point
- `css/germinator.css` - CoSE Design System
- `js/core/` - Ported algorithms (segmentation, registration, tracking, scoring)
- `js/ui/` - Canvas renderers, chart components, and ZIP uploader
- `js/app.js` - Main application orchestrator

## Deployment

This repository is configured to automatically deploy to GitHub Pages. Every time you push to the `main` branch, a GitHub Action (`.github/workflows/pages.yml`) bundles the static files and publishes the live site.

To enable this on your fork:
1. Go to your repository **Settings** > **Pages**.
2. Under "Build and deployment", set the Source to **GitHub Actions**.
3. Push a commit to `main`, and the action will handle the rest.
