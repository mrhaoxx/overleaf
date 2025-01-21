import usePersistedState from '../../../shared/hooks/use-persisted-state'
import getMeta from '../../../utils/meta'
import { useCallback } from 'react'
import Close from '@/shared/components/close'

export default function SurveyWidget() {
  const survey = getMeta('ol-survey')
  const [dismissedSurvey, setDismissedSurvey] = usePersistedState(
    `dismissed-${survey?.name}`,
    false
  )

  const dismissSurvey = useCallback(() => {
    setDismissedSurvey(true)
  }, [setDismissedSurvey])

  if (!survey?.name || dismissedSurvey) {
    return null
  }

  // Short-term hard-coded special case: hide the "DS nav" survey for users on
  // the default variant
  if (survey?.name === 'ds-nav') {
    // temp workaround to allow for offline survey to target specifically users not on ds-nav split test
    survey.preText =
      'Do you want to use Overleaf offline or do you struggle with unstable connections?'
    survey.name = 'offline-mode'
    survey.linkText = 'We want your feedback'
    survey.url = 'https://forms.gle/CUVaduCnqAauVi9aA'
  }

  return (
    <div className="user-notifications">
      <div className="notification-entry">
        <div role="alert" className="survey-notification">
          <div className="notification-body">
            {survey.preText}&nbsp;
            <a
              className="project-list-sidebar-survey-link"
              href={survey.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              {survey.linkText}
            </a>
          </div>
          <div className="notification-close notification-close-button-style">
            <Close variant="dark" onDismiss={() => dismissSurvey()} />
          </div>
        </div>
      </div>
    </div>
  )
}
