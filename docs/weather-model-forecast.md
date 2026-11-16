# 区域气象预报

气象地球右栏默认读取 GFS 全球 10 米风速。WRF 和 ClimaX 读取经审核的区域预报。右栏显示模型版本、预报起报和有效时间、文件来源、发布版本以及末帧有效格点数。回放区域编码与发布区域一致时，右栏跟随该区域。在模型拥有多个已发布区域时，也可直接在右栏切换。

首期指标是区域内有效格点的 10 米水平风速算术均值，单位为 m/s。先在每个格点对 U/V 计算模长，再对双分量齐全的格点取平均。以四至经纬度筛选格点中心，支持东经 0–360° 的源经度编码。两模型具有同一区域四至、同一起报时刻和重合的非空有效时刻时，可在同一图中对照。格点分辨率可能不同，需要一致采样时在批准的数据加工步骤中统一网格。

## 入库和审核

1. 管理员在应用过 `v11-data-agent-schema.sql` 的 V11 数据库中执行 [天气模型迁移](../scripts/v11-weather-model-forecast.sql)。Web 继续使用 `DATA_AGENT_DATABASE_URL` 和 `green_agent_ro`。
2. 在独立导入环境安装 [Python 依赖](../scripts/weather-model-requirements.txt)。用 `OGW_WEATHER_PYTHON` 指定 Python 路径。按需安装 PyGRIB（如需从源码构建，先安装 ecCodes）或提供 PATH 中的 CDO。默认读取器为 WRF 的 `netcdf4` 和 ClimaX 的 `iris`。GRIB 输入可显式选择 `--reader earthkit-data` 或 `--reader pygrib`。
3. 保留从批准来源取得的原始文件及其永久地址，可先归档到受控对象存储。用本地文件及单次起报的清单调用导入器。审核时将清单模型、起报时间、源文件身份及版本与原始发布记录核对。
4. 用独立的 `DATA_AGENT_INGEST_DATABASE_URL` 和 `green_agent_ingest` 提交批次。审核人员用独立的 `DATA_AGENT_REVIEW_DATABASE_URL` 和 `green_agent_review` 审批。审核通过后，曲线从标准事实表和快照读取，原有版本可通过 DataRef 重查。相同文件、清单和加工输出会复用已有批次。

清单示例使用 [公开的 WRF 历史样本](https://github.com/xarray-contrib/xwrf-data/blob/7a6100a48ee1b39a3fce3465e4da9e2c2a53cf6c/data/mercator_sample.nc)。

```json
{
  "model": "wrf",
  "model_version": "WRF 3.8.1",
  "region_code": "gulf-of-mexico-test",
  "region_name": "墨西哥湾样本区",
  "bounds": [-93.01, 21.8, -87.42, 26.65],
  "issue_time": "2005-08-28T00:00:00Z",
  "source_uri": "https://github.com/xarray-contrib/xwrf-data/blob/7a6100a48ee1b39a3fce3465e4da9e2c2a53cf6c/data/mercator_sample.nc"
}
```

```sh
node scripts/import-weather-model.mjs inspect --file ./forecast.nc --manifest ./manifest.json
node scripts/import-weather-model.mjs stage --file ./forecast.nc --manifest ./manifest.json
node scripts/import-weather-model.mjs review --batch <批次UUID> --decision publish --note '已核对源文件与入库口径'
```

- WRF 原生 NetCDF 使用 `Times`、`START_DATE`、`XLAT/XLONG` 和 `U10/V10`。可验证的历史样本在 2005-08-28 12:00 至 21:00 UTC 有四帧，各帧覆盖 2,304 个格点。
- ClimaX 接收天气任务微调后的运行输出。将物理单位下的 10 米风分量写为 CF NetCDF，变量名使用 `10m_u_component_of_wind / 10m_v_component_of_wind` 或 `u10 / v10`，提供经纬度、有效时间和 `forecast_reference_time`，清单写入任务 checkpoint 或运行版本。官方发布的基础预训练 checkpoint 用于下游微调，发布时需要已运行的天气预报结果。 [ClimaX 官方使用说明](https://microsoft.github.io/ClimaX/usage/)
- GRIB 使用 10 米高度的 `10u / 10v` 消息，每个有效时刻须有配对分量和相同网格。若需要 CDO 预处理，常规格点可使用 `--cdo-crop` 裁剪，或 `--grid-step <角度>` 映射到覆盖范围内的规则网格。原生 WRF 网格用 NetCDF 读取器直接按经纬度裁剪。
- 源缺测在发布后保留为空，外发工具可检查有效格点数和总格点数。全缺测批次、同帧重复分量、起报不一致及同地区编码的不同四至会被拒绝。

## Agent 调用

`/api/mcp/data-agent` 提供三项只读工具。

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| `inspect_weather_file` | `batch_id` | 已登记文件的 SHA-256、读取器、变量、时间范围、覆盖和审核状态 |
| `list_weather_forecast_regions` | 无 | 已发布地区及对应模型 |
| `query_published_weather_forecast` | `model`、`region_code`，可选 `issue_time`、`version`、`limit` | 风速曲线、起报/有效时间、缺测及 DataRef |

普通气象查询也支持 `model` 和 `region_code`，传给现有 `query_published_data` 时同时指定两项。数据库 Agent 的自然语言入口可以查地区目录并按模型查询。样本应先在隔离库里核验文件检查、待审隔离、审核、固定版本重查，以及右栏桌面和触屏入口。
