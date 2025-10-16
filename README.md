# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## AI-Powered Headlines & Press Coverage

The league news modal now uses the ChatGPT API to punch up headlines and attach a playful 8-10 sentence article to every story. A
dedicated “Articles From The Press” button also generates longer-form weekly coverage that references current records, streaks,
front-office moves, and recent results. To enable the AI features, provide an OpenAI API key when running the client:

```
REACT_APP_OPENAI_API_KEY=your_api_key_here npm start
```

Optional overrides:

- `REACT_APP_OPENAI_MODEL` — change the chat completion model (defaults to `gpt-4o-mini`).
- `REACT_APP_OPENAI_API_URL` — point to an alternate OpenAI-compatible endpoint.

If no key is supplied, the app falls back to locally generated summary text so the UI continues to function.

## League Record Book & Wiki

From the global header you can open a dedicated League Records modal that highlights the top single-season accomplishments for
players, teams, and coaches. The record book automatically refreshes whenever a season concludes, capturing the record holder,
season, team, and total set for each category.

The League Wiki button opens a hub of Wikipedia-style team pages that track franchise histories, notable moments, and a running
ledger of awards, playoff appearances, and Blooperbowl titles. Each offseason the simulator updates every team's article using the
latest season results. Provide the same OpenAI API key described above to let the AI expand and rewrite wiki sections; without a
key, the pages still refresh with locally generated summaries.

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
