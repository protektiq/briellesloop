const PagePlaceholder = ({ title, routeLabel }) => {
  return (
    <section className="placeholder-card" aria-label={`${title} placeholder`}>
      <h1 className="display-lg">{title}</h1>
      <p>
        Route: <strong>{routeLabel}</strong>
      </p>
      <p>TODO</p>
    </section>
  )
}

export default PagePlaceholder
