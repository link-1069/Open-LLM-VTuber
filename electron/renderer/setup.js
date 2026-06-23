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
    // Send a minimal SDP POST to check if the WHEP endpoint is reachable.
    // A 200/201 means success; 400 means server reached but bad SDP (still reachable).
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: 'v=0\r\n',
    })
    if ([200, 201, 400, 404].includes(resp.status)) {
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
    setStatus(`保存失败: ${e.message}`, 'err')
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
