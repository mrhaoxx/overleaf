import { screen, within } from '@testing-library/dom'
import { expect } from 'chai'
import fetchMock from 'fetch-mock'
import SettingsFontSize from '../../../../../../frontend/js/features/editor-left-menu/components/settings/settings-font-size'
import { EditorLeftMenuProvider } from '@/features/editor-left-menu/components/editor-left-menu-context'
import { render } from '@testing-library/react'
import { EditorProviders } from '../../../../helpers/editor-providers'

describe('<SettingsFontSize />', function () {
  const sizes = ['10', '11', '12', '13', '14', '16', '18', '20', '22', '24']

  afterEach(function () {
    fetchMock.reset()
  })

  it('shows correct menu', async function () {
    render(
      <EditorProviders>
        <EditorLeftMenuProvider>
          <SettingsFontSize />
        </EditorLeftMenuProvider>
      </EditorProviders>
    )

    const select = screen.getByLabelText('Font Size')

    for (const size of sizes) {
      const option = within(select).getByText(`${size}px`)
      expect(option.getAttribute('value')).to.equal(size)
    }
  })
})
