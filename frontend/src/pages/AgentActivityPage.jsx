const AgentActivityPage = () => {
  return (
    <section className="dash-section">
      <div className="dash-frame">
        <h2 className="dash-title">
          Agent <em>activity</em>
        </h2>
        <p className="dash-meta" style={{ marginTop: 12 }}>
          Approve / revert controls and live agent runs ship in Task 12. This screen uses the same
          PIN gate as the parent dashboard.
        </p>
        <div className="dash-agent-feed" style={{ borderTop: 'none', paddingTop: 16 }}>
          <ul className="dash-feed-list">
            <li className="dash-feed-item">
              <span className="dash-feed-agent">Placeholder</span>
              <span className="dash-feed-text">
                No agent actions yet — the feed will list calibration, content, frustration, and
                insight agents with reasoning and controls.
              </span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  )
}

export default AgentActivityPage
