# 新PostgreSQL目标库转存：预检、验证与恢复方案

> 更新：2026-09-04；状态：核心批次已迁入并分类，服务器完整备份和17表实际恢复通过；本机网站已切zyz并通过6项API验收。缺失历史源仍待补齐。
> 本文件不保存密码、完整连接串或私钥。

> 2026-09-18现状覆盖：当前库已增长到25张业务表并含73,050个气候日帧及预测数据；下述1.04GB、17表恢复只证明早期基线可恢复，不能证明当前库可恢复。20个气候NetCDF缺口已经关闭；当前P0是使用`scripts/run-server-pg-backup.ps1 -BackupAndVerify`生成新备份并完成隔离恢复。

## 已完成结果（优先于下方历史记录）

- 服务器完整备份：`D:/pgbackups/zyz-server-20260904T133920680Z.dump`，1,040,051,387字节；SHA-256 `1ACEE10281E4B07F3587C77C9B6A09CCAD2B502B3919DE721452E9F341575798`。归档目录/全部块读取通过，实际恢复后17表行数和碳哈希通过，临时测试库已清理。
- 经用户提供管理账号的PG通道触发固定用途的本机命令，无SSH、无认证规则变更。普通zyz账号负责备份/恢复和网站连接；管理会话中的凭据仅作临时参数/进程输入，不写入服务器配置。
- 本机.env.local已切新库，旧配置受限保存；6项API验收通过，临时3009测试服务停止。远端已部署网站未在本轮另行修改。
- 最新实测与来源清单见工作区`outputs/20260904-pg-migration/新PG实际迁移清单.md`和四份verification/result JSON。重试服务器备份用`run-server-pg-backup.ps1`，实际恢复验证用同脚本`-Verify`；每次使用唯一目标名，不覆盖现有备份。
- 尚缺20NetCDF和其他碳部门；原始源文件服务器归档、PostGIS、AI权限、定时备份、异机副本未完成。早期.incomplete备份仅保留作失败证据，不用于恢复。

## 前次续传/重试结果（历史记录）

- 最新一次重试：认证时碳日帧2,739，开启临时防待机后仍在COPY碳表断开，残留397,574,163字节.incomplete.dump；防待机已释放，未改电源计划。随后pg_isready无响应。继续需要服务器服务/日志或运行本机备份脚本，不重复原样远程整库导出。

- 14:45最新复测：单独备份重试传至602,907,132字节后COPY碳帧表断开；随后已重新认证，verify结果checksPassed=true。当前能登录，不再沿用之前“PG无响应”的状态。下一步在服务器运行`scripts/server-local-pg-backup.ps1`，规避远程长连接导出；本机隔离恢复脚本及API验收脚本仍未执行。

- 本地可恢复核心数据已迁入并核验：Power2,708日（2019-01-01至2026-05-31）、total31日（仅2021-03）、设施9,143、数据中心24、VRE2,560、GISPO222,943、GFS13、完整OSM1,004,207。
- 最终碳/天气SHA不符0、VRE长度错误0、设施坐标越界0、文件导入error0。weather/power/carbon/shared视图、34目录、5,904文件登记已落库；17张表精确统计见工作区`outputs/20260904-pg-migration/final-verification.json`及`新PG实际迁移清单.md`。
- 远程pg_dump在COPY carbon_emission_frames期间断线，后续PG无响应；残留16,279,587字节已标`.incomplete.dump`，不构成完整备份。没有删源文件，没有切换.env.local，没有Git提交。
- 数据导入验收与备份完成分开：前者通过，后者失败；不重导已完成核心批次。下一步检查PG服务/日志，恢复连接重试备份，或在服务器本地用pg_dump导出避免长距离传输；再切应用并执行`node scripts/verify-migrated-app.mjs http://127.0.0.1:3009`。
- 20NetCDF、缺失碳部门、原始文件服务器D盘归档、PostGIS和AI权限仍未完成。不能据当前通过的本地恢复批次宣称“所有历史数据已恢复”。

## 前一次中断时进度（历史记录）

- 目标身份：Windows PG17.5、DB/role=zyz、地址218.197.118.49；初始空库8,072,339字节，仅plpgsql，应用角色非超级用户且可建schema。当前无PostGIS。
- 安全基线：工作区`outputs/20260904-pg-migration/baseline-20260903T164556Z`保存197文件及验证；`zyz-before-import.dump`为805字节空目标快照，pg_restore --list通过，未做隔离恢复测试。未Git提交。
- 已完成：设施9,143、数据中心24、VRE2,560、GISPO222,943、GFS13、完整OSM1,004,207，另有预览/边界1,681和显示瓦片224；这些为批次提交/核验日志，不代表全库最终验收通过。
- Power月批次完成2019-01至2021-06；2021-07仅部分写入。`migration-state.json`保留完成列表，月份内部依照源哈希跳过已写帧，不清空重导。
- 当前阻塞：TCP5432可达，psql立即收到server closed the connection unexpectedly，pg_isready no response。无服务器日志，不能确定为服务器进程还是网络中间环节。请在目标PowerShell执行`Get-Service PostgreSQL17; Get-Content -LiteralPath 'D:\pgdata\pg.log' -Tail 60`。
- 源质量：核心88月Power全部通过；scratch中的InternationalAviation2024-06及total2019-02异常隔离。额外Power2026-05和total2021-03通过但尚未追加。记录在`carbon-source-audit.json`。
- 恢复后执行安全密码提示启动器`./scripts/run-new-pg-migration.ps1 -Mode restore`续传；成功后`-Mode finalize`执行附加合格源、三地球分类/目录、逐项核验和迁移后备份；最后`-Mode verify`。只有全部通过后才更换应用连接。
- 未完成：三地球视图、最终资产清单实测、迁移后dump、应用切库、20NetCDF补下载、缺失碳部门及服务器D盘原始文件归档。PG写入只恢复数据库内容，不代表本地原始文件已复制到服务器。

## 1. 目标与现场证据

- 用户已明确确认：`zyz`数据库部署在此前的`218.197.118.49`服务器；`127.0.0.1`指该服务器内部，不是当前电脑。
- 用户提供：PostgreSQL 17.5，数据库/应用角色均为`zyz`，目标机回环端口5432；Windows服务`PostgreSQL17`；程序在`D:\pgsql\pgsql\bin`，数据在`D:\pgdata`。
- 当前执行环境不是已确认的目标机：给定程序及数据路径均不存在；当前执行环境`127.0.0.1:5432`连接被拒绝，未发现PostgreSQL服务。
- 当前电脑另有`C:\Program Files\PostgreSQL\17\bin\psql.exe`客户端；有客户端不能证明目标数据库在这台电脑上。
- 对之前提供的服务器仅检查常用SSH端口22，5秒内未建立连接；这不能证明服务器停机，也不能排除非默认端口/VPN。
- 本机没有SSH config，无法从已有配置获得替代入口。未尝试数据库密码登录，未修改防火墙或应用连接配置。
- Git状态共57项修改/未跟踪记录；仅计数，不等于改动已分类审查或已保存安全基线。

### 2026-09-03后续检查：历史发现

- 用户报告Windows 11专业版10.0.22621，PostgreSQL17服务停止、sshd运行、OpenSSH.Server已安装；C盘剩84.2GB、D盘剩25370.1GB。这些为用户提供结果，尚未远程独立复核。
- 后续TCP复测22与3389可达。SSH22握手实际返回`OpenSSH_9.6p1 Ubuntu-3ubuntu13.18`，与Windows目标不一致；不能据此认定已连到正确服务器。
- 未受信任的公网22主机ED25519指纹：`SHA256:I3M8Wh5PdHJ0UDTkvJ1r93qiwI0V2KCMXtuWENb11n0`。严格主机验证已拒绝继续，未进入认证，未发送数据库/Windows密码，未写入known_hosts。
- 用户随后通过Windows主机公钥文件取得的ED25519指纹：`SHA256:AxmNLettTdgNS+VGDV6bg7KJjqPsVf5eFbEytf8OyI4`，与公网22不同。该结果为用户提供的参考证据，不能在不匹配时放行；目前仍未取得Windows监听端口。公钥备注不作为登录账号或实际主机身份的独立证明。
- 可能存在网关、NAT映射或其他机器，原因尚未确定。必须由用户在Windows RDP会话内读取实际主机指纹、SSH监听端口，必要时向网络管理员核对公网SSH映射；不得跳过主机验证或向未知主机安装公钥。
- 本机已准备专用Ed25519迁移密钥，目录ACL限制当前用户和SYSTEM；公钥尚未安装到服务器，未创建远端账号。该步骤不能记为远程授权完成。
- 暂不根据Stopped单一状态直接启动PG；先检查postgres进程和5432监听，排除手动运行实例。

### 2026-09-04后续检查：路径排查经过

- 用户已提供目标em1网卡地址`218.197.118.49`以及sshd监听`[::]:22`、PID12852；还有WSL/SSTAP等虚拟网卡。这些仍属用户提供的现场输出。
- IPv6通配监听不能单独证明IPv4也由Windows sshd接收；此前按sshd进程筛选监听者，不足以排除其他进程的IPv4端口转发。
- 本轮强制IPv4并禁用SSH配置、ProxyCommand/ProxyJump和身份认证后，握手仍返回Ubuntu及`SHA256:I3M8Wh5PdHJ0UDTkvJ1r93qiwI0V2KCMXtuWENb11n0`；严格主机验证中止连接，未接受密钥或进入登录。
- 本机`Find-NetRoute`选中`aTrustVNIC`，源`59.69.125.122`、路由`218.197.96.0/19`、下一跳`59.69.125.124`；因此此次访问公网格式目标地址实际经过VPN，不是已验证的普通公网直连。没有修改路由或关闭VPN。
- 下一步在服务器查22端口全部监听进程和`netsh interface portproxy show all`。若发现指向WSL的转发，先核实其用途；若未发现，再核验服务器本机握手及VPN路径。空portproxy结果也不能排除其他转发机制。尚不能把VPN或WSL认定为根因。

### 2026-09-04 Windows独立SSH方案（后续已暂缓）

- 用户提供全部监听者：wslrelay在`::1:22`（PID87752）、Windows sshd在`[::]:22`（PID12852）、svchost在`0.0.0.0:22`（PID9384）。portproxy明确把IPv4 22转到`172.21.91.47:22`，并另有8899、3000和80的WSL转发。
- 该现场输出解释了为何IPv4握手收到Ubuntu而非Windows。WSL主机公钥尚未独立核验，不因此自动信任22上收到的密钥；不再把VPN本身当作已知故障原因。
- 用户尚未明确授权删除转发；现有规则全部保留。推荐Windows SSH新增独立2222入口，但该端口仅为待确认方案，未检查占用、未配置、未开放。
- 若获同意，先在RDP内核验sshd真实服务路径、有效配置、现有会话、2222占用和防火墙规则；备份后采用最小增量，尽量保留原有Windows IPv6监听与所有WSL业务。配置须校验通过后才能生效，保留RDP回退能力。
- 只允许经服务器侧核实的迁移来源访问新入口，不将本机VPN源地址直接当作服务器必然看到的来源；密钥认证使用专用普通迁移账号。还需实测校园/VPN网络是否允许新端口，不能保证本机防火墙放行后一定可达。
- 新入口必须匹配用户提供的Windows参考指纹，才能授权登录；PG5432仍不向公网开放。未实施任何网络或服务更改。

### 2026-09-04当前方向：优先数据库直连

- 用户希望直接使用PG账号；无需把SSH作为数据库导入的强制前置条件。远程直连需使用目标可达地址，不能把当前电脑的127.0.0.1当作远程Windows。独立SSH2222方案暂缓，现有转发保持不动。
- TCP实测：当前电脑127.0.0.1:5432拒绝连接；218.197.118.49:5432可连接。SSLRequest探测无正常响应；另一次PG启动包发送后等待响应5秒超时。启动包仅含用户名/数据库名和探测程序名，无密码；未认证、未执行SQL。当前不能证明端口后的服务就是目标PG。
- 下一步由用户在服务器查询PostgreSQL17服务状态、5432全部监听进程及可执行文件路径；服务Stopped也须排除手动运行实例。确认实例、网络权限及加密保护后再尝试认证，不盲目修改应用连接或开放所有来源。
- 如可信VPN路径允许直连PG，可从当前电脑解析本地源文件并通过PG协议写入目标库，仍须先做既有内容备份、脚本审查和小批次验证。服务器D盘原始文件归档另用受控文件通道/服务器下载完成，数据库账号不授予操作系统权限。
- 用户再次明确只推进新库替代及真实数据导入，并要求区分三个地球。本轮使用正式psql客户端直连目标，12秒连接超时，退出码1；未进入密码认证、未执行身份查询或导入。当前新库已确认导入记录为0，不以文件准备或端口可达计入迁移进度。

## 2. 开始写入前必须完成

1. 先确认目标PG实例及可信、获准的数据库连接路径；优先直连，SSH仅作为必要时的隧道或文件/服务管理备选。当前需解决5432 TCP可达但PG协议无响应的问题，不能把网络端口可达当作登录成功。
2. SSH使用密钥、核验主机指纹、限制来源；数据库不需要向公网开放5432。密钥由用户授权安装，私钥不发到聊天。
3. 在目标机检查服务、版本、目标数据库身份、磁盘容量、已有表和扩展；避免误连旧云库或其他项目。
4. 先分类审查现有Git修改并保存不含秘密/大文件的可恢复文件基线；不擅自Git提交。
5. 对目标数据库的既有数据、角色权限及配置保存备份。目标表已经存在时，不直接运行当前脚本覆盖；先比较来源与唯一键，再决定合并方式。
6. 密码通过受限本地配置或进程环境传入，不输出到日志、不写入版本库。用户贴出的连接串含Markdown转义，应按结构化字段组装，不原样复制反斜杠。

## 3. 只读身份核验SQL

```sql
SELECT version(), current_database(), current_user,
       inet_server_addr(), inet_server_port();
SELECT pg_database_size(current_database()) AS database_bytes;
SELECT extname, extversion FROM pg_extension ORDER BY extname;
SELECT schema_name FROM information_schema.schemata ORDER BY schema_name;
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema IN ('website_data', 'public')
ORDER BY table_schema, table_name;
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin
FROM pg_roles WHERE rolname = current_user;
```

预期必须明确是`zyz`目标库。应用日常连接不得使用超级用户。项目表实际使用`website_data` schema，不能仅根据用户连接串中的`schema=public`把表全部改名或移动。

## 4. 转存范围与顺序

以`WEBSITE_DATA_SOURCE_INVENTORY.md`为来源总清单，`DATA_MIGRATION_AUDIT_2026-09-01.md`为本地恢复证据。

| 阶段 | 数据 | 预期目标 |
|---|---|---|
| 先导小批次 | 数据来源目录、官方统计、少量真实设施和边界 | 验证编码、单位、唯一键、角色权限和页面查询兼容 |
| 地图基础 | 真实能源设施、PeeringDB、本地Natural Earth与OSM GeoJSON/瓦片 | 结构化设施、地理要素、目录和显示瓦片表 |
| 时序基础 | VRE小时情景、GISPO潜力、真实GFS快照 | 对应时序、潜力和气象表；快照需标日期，不冒充实时 |
| 碳数据 | GRACED Power88个月，随后逐项核验零散其他部门 | 日帧、分块、月档案和校验记录；不得把total和部门重复相加 |
| 缺失补齐 | 20个气候NetCDF、其他缺失GRACED部门、PeeringDB原始响应等 | 下载、校验后分批入库，不能把历史数据库计数当作已转存 |
| 后续授权数据 | ERA5、真实功率/负荷等 | 取得账号或授权原文件后再纳入 |

不恢复已停用的假数据；不把未下载候选数据计为已迁移；不因“所有数据”而擅自镜像商业在线底图。

原始MAT/NetCDF/PBF大文件的归档方式尚待确认：建议源文件留服务器数据盘、PG保存登记及可查询结果；如果用户要求连原始字节也全部入PG，需另设计分块、容量和恢复方案，不能直接把多GB文件作为单字段导入。当前没有替用户作出这一存储选择。

### 按三个地球管理数据（用户已要求，入库待连接恢复）

沿用现有`website_data`表结构与`dataset_catalog.earth_layer`分类字段，不为区分页面而盲目复制数据或搬迁全部表。现有结构已包含来源链接、时间范围、空间分辨率、目标表与获取/入库状态；补充分类和质量信息以本轮实测为准，不照搬旧库历史状态。

| 主归属 | 内容 | 主要目标表 |
|---|---|---|
| 气象地球 | GFS真实预报、CMIP6气候情景 | weather_forecast_fields、climate_projection_sources/grids/daily |
| 电力地球 | 能源设施、数据中心、OSM电网、GISPO潜力、VRE容量因子情景 | energy_assets、data_centers、renewable_resource_potential、climate_vre_hourly；按来源区分geo_features/vector_tiles/json_documents |
| 碳地球 | GRACED按部门月档案、逐日排放帧及分块 | carbon_source_archives、carbon_emission_frames、carbon_emission_frame_chunks |
| 共用基础 | 行政边界、跨地球复用空间数据与来源/导入审计 | 按来源区分geo_features/vector_tiles/json_documents；dataset_catalog、source_files、import_runs作为共用管理表 |

- 每个数据集登记一个主归属；跨地球使用时在metadata记录使用范围，复用同一份事实数据。同表容纳多个数据集时按dataset_key、source/path等真实字段映射，不能仅凭表名将所有行归为同一地球。
- 来源与许可、字段及单位、时间范围/时区、空间粒度、真实性类别（观测/统计/正式预报/模型情景）、缺失率、更新方式、导入批次、数量及校验结果均须可追溯；未知值保持未核验，不填写虚构的0缺失率。
- 旧目录中的“装机潜力/调度地球”属于历史命名，导入新库时核对具体条目后归入电力地球，不视为第四个正式业务地球。共用基础是管理类别，不是第四个页面。
- 每批以目标查询验收；只在实际数据完整、范围及数量校验通过后将database_status标记为已入库。不执行旧目录同步脚本来提前标记历史完整状态。

## 5. 现有脚本的覆盖风险

- `scripts/import-data-to-postgres.mjs`含多处`ON CONFLICT DO UPDATE`，会按ID/路径覆盖已有值；重复执行并非绝对无副作用。
- 同脚本会按源文件路径删除超出当前要素序号的旧`geo_features`行；因此只允许在已核实目标、已有备份及比较结果的前提下运行。
- 本次仅检查上述语句，尚未完成全部导入脚本的安全审查；不将其标为可直接无监督执行。
- 未进行迁移性能实测，先导样本通过前不启动全量数十GB写入。

## 6. 每批完成后的验证

- 对照文件清单核对哈希/大小、记录数、部门/技术、起止日期、字段单位和源版本；失败批次不能记为完成。
- 唯一键重复为0，跨源ID不能误合并；禁止用零填补未观测的数据。
- 时区分别保留：GFS UTC、气候投影项目记录UTC+08；实际重新下载文件仍逐个核验。
- GISPO四类技术分开校验，源773,653单元与聚合222,943条不是同一计数。
- GRACED Power目标2019-01-01—2026-04-30共2,677个连续日帧；2026-05单独核验，不混淆目标范围。
- VRE32区域×40年×2技术预计2,560组；容量因子与估算功率/发电量不混用。
- 只有完整补回并导入20个气候源文件后，才可验证历史73,050日块目标；不得先写“已完成”。

数据表存在后使用以下查询作为部分验收（还需结合文件清单验证内容）：

```sql
SELECT sector, COUNT(*) AS frames, MIN(observed_on), MAX(observed_on)
FROM website_data.carbon_emission_frames GROUP BY sector ORDER BY sector;
SELECT region_id, year, technology, COUNT(*)
FROM website_data.climate_vre_hourly
GROUP BY region_id, year, technology HAVING COUNT(*) > 1;
SELECT source, COUNT(*) FROM website_data.energy_assets GROUP BY source;
SELECT COUNT(*) FROM website_data.data_centers;
```

## 7. 备份与回退

- 目标已有内容时先导出可恢复备份并保存权限清单；确认备份可在隔离位置恢复，而不只是生成一个文件。
- 源文件保留本机副本；服务器复制/下载完成后比对哈希，不删除本地原件。
- 每批使用事务或明确批次边界，记录已成功/失败范围，避免中断后盲目全量重跑。
- 恢复方案先在隔离库验证，再由用户确认是否切换；不自动DROP、TRUNCATE或覆盖整个`zyz`数据库。
- 不将运行中PG数据目录的普通文件复制当作一致性数据库备份；备份方法按目标状态单独验证。
- 启用未来AI写入前，应用只读查询、受控数据导入和数据库管理权限必须分离；本轮不实现自由Text-to-SQL写入。

## 8. 当前完成与未完成

已完成：本机位置核验、SSH常用端口检查、公网SSH主机身份差异定位、本机专用密钥准备、Git状态计数、部分导入覆盖风险定位、核验/回退方案记录。

未完成：远程通道建立及主机身份核验、目标库登录、既有数据备份、完整脚本审查、全量文件传输、数据导入和网站切换。目标地址已由用户确认，没有使用用户提供的密码执行写入。
