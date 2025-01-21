import { screen, within } from '@testing-library/dom'
import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import SettingsPdfViewer from '../../../../../../frontend/js/features/editor-left-menu/components/settings/settings-pdf-viewer'
import { render } from '@testing-library/react'
import { EditorProviders } from '../../../../helpers/editor-providers'
import { EditorLeftMenuProvider } from '@/features/editor-left-menu/components/editor-left-menu-context'

describe('<SettingsPdfViewer />', function () {
  afterEach(function () {
    fetchMock.reset()
  })

  it('shows correct menu', async function () {
    render(
      <EditorProviders>
        <EditorLeftMenuProvider>
          <SettingsPdfViewer />
        </EditorLeftMenuProvider>
      </EditorProviders>
    )

    const select = screen.getByLabelText('PDF Viewer')

    const optionOverleaf = within(select).getByText('Overleaf')
    expect(optionOverleaf.getAttribute('value')).to.equal('pdfjs')

    const optionBrowser = within(select).getByText('Browser')
    expect(optionBrowser.getAttribute('value')).to.equal('native')
  })
})
