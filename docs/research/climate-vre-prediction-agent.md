# Climate VRE Prediction Agent

This app uses the paper-provided VRE output file as the first-version data source for GFDL-ESM4 SSP126. It does not recompute wind and PV generation from the five meteorological NetCDF variables.

## Source

- Paper: https://www.nature.com/articles/s41597-025-06396-5
- GFDL-ESM4 SSP126 Zenodo record: https://doi.org/10.5281/zenodo.15832921
- Method code: https://github.com/RuijieChen-123/Convert_climate_variable_to_VRE_generation
- Local input: `../data/VRE_gfdl-esm4_ssp126_2021_2060.mat`

## Run

```powershell
npm run agent:climate-vre
```

If the default Python environment does not include `h5py` and `numpy`, run the script with an environment that does:

```powershell
& "C:\Users\53472\anaconda3\python.exe" scripts\build-climate-vre-data.py --input "..\data\VRE_gfdl-esm4_ssp126_2021_2060.mat"
```

## Outputs

- `public/data/climate-vre/manifest.json`: scenario metadata and data index.
- `public/data/climate-vre/summary.json`: annual and monthly capacity-factor summaries.
- `public/data/climate-vre/hourly/{regionId}/{year}-{technology}.json`: on-demand hourly capacity-factor series.
- `public/data/climate-vre/agent-report.json`: validation result, region counts, warnings, and fallback province assignments.

The UI displays capacity factor and renewable generation potential. It intentionally avoids MW/GWh labels until a capacity basis is selected.
