import { useParams } from 'react-router-dom'
import PagePlaceholder from '../components/PagePlaceholder'

const sanitizeSkillName = (value) => {
  if (typeof value !== 'string') {
    return 'unknown'
  }

  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 48) {
    return 'unknown'
  }

  const normalized = trimmed.toLowerCase().replace(/[^a-z0-9-]/g, '')
  return normalized.length > 0 ? normalized : 'unknown'
}

const PracticePage = () => {
  const { skillName } = useParams()
  const safeSkillName = sanitizeSkillName(skillName)

  return (
    <PagePlaceholder
      title="PracticePage"
      routeLabel={`/practice/${safeSkillName}`}
    />
  )
}

export default PracticePage
