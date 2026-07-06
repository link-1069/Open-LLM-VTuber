const urlInput  = document.getElementById('whep-url')
const btnLatest = document.getElementById('btn-latest')
const btnTest   = document.getElementById('btn-test')
const btnConfirm = document.getElementById('btn-confirm')
const statusEl  = document.getElementById('status')
let verifiedUrl = ''

function setStatus(msg, type) {
  statusEl.textContent = msg
  statusEl.className = type || ''
}

async function prefillSavedConfig() {
  try {
    const config = await window.electronAPI.getConfig()
    if (config?.whep_url) {
      urlInput.value = config.whep_url
      verifiedUrl = ''
      btnConfirm.disabled = true
    }
  } catch (e) {
    setStatus(`读取配置失败: ${e.message}`, 'err')
  }
}

btnLatest.addEventListener('click', async () => {
  setStatus('正在获取最新 id...')
  verifiedUrl = ''
  btnLatest.disabled = true
  btnConfirm.disabled = true
  try {
    const resp = await fetch('http://localhost:8500/api/active-streams', { method: 'GET' })
    if (!resp.ok) {
      setStatus(`获取最新 id 失败: HTTP ${resp.status}`, 'err')
      return
    }

    const body = await resp.json()
    if (!body?.ok) {
      setStatus('获取最新 id 失败: 接口返回不可用', 'err')
      return
    }

    const whepUrl = window.setupProbe.getWhepUrlFromStreamId(body?.stream?.av_stream_id)
    if (!whepUrl) {
      setStatus('获取最新 id 失败: 未找到 stream id', 'err')
      return
    }

    urlInput.value = whepUrl
    setStatus('已获取最新 id，请先完成连接测试', 'ok')
  } catch (e) {
    setStatus(`获取最新 id 失败: ${e.message}`, 'err')
  } finally {
    btnLatest.disabled = false
  }
})

btnTest.addEventListener('click', async () => {
  const url = urlInput.value.trim()
  if (!url) { setStatus('请输入地址', 'err'); return }
  setStatus('测试中...')
  verifiedUrl = ''
  btnTest.disabled = true
  btnConfirm.disabled = true
  try {
    const probeUrl = window.setupProbe.getSrsApiUrlFromWhepUrl(url)
    if (!probeUrl) {
      setStatus('✗ 地址格式无效', 'err')
      btnConfirm.disabled = true
      btnTest.disabled = false
      return
    }

    // Check the SRS HTTP API instead of sending a fake SDP offer to WHEP.
    const resp = await fetch(probeUrl, { method: 'GET' })
    if (resp.ok) {
      if (urlInput.value.trim() !== url) {
        setStatus('输入已更改，请重新测试', 'err')
        verifiedUrl = ''
        btnConfirm.disabled = true
        btnTest.disabled = false
        return
      }
      setStatus('✓ 服务器可达', 'ok')
      verifiedUrl = url
      btnConfirm.disabled = false
    } else {
      setStatus(`✗ 服务器返回 HTTP ${resp.status}`, 'err')
      btnConfirm.disabled = true
    }
  } catch (e) {
    setStatus(`✗ 无法连接: ${e.message}`, 'err')
    btnConfirm.disabled = true
  }
  btnTest.disabled = false
})

btnConfirm.addEventListener('click', async () => {
  const url = urlInput.value.trim()
  if (!url || url !== verifiedUrl) {
    setStatus('请先完成连接测试', 'err')
    return
  }
  btnConfirm.disabled = true
  try {
    await window.electronAPI.saveConfig({
      whep_url: url,
      last_updated: new Date().toISOString(),
    })
    await window.electronAPI.openMainWindow()
  } catch (e) {
    setStatus(`保存或打开失败: ${e.message}`, 'err')
    btnConfirm.disabled = false
  }
})

// Allow pressing Enter in the input to trigger test
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnTest.click()
})

urlInput.addEventListener('input', () => {
  verifiedUrl = ''
  btnConfirm.disabled = true
})

prefillSavedConfig()
