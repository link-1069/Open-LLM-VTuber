const urlInput  = document.getElementById('whep-url')
const btnTest   = document.getElementById('btn-test')
const btnConfirm = document.getElementById('btn-confirm')
const statusEl  = document.getElementById('status')
let verifiedUrl = ''

function setStatus(msg, type) {
  statusEl.textContent = msg
  statusEl.className = type || ''
}

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
