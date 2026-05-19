pipeline {
    agent any

    // Re-deploy only when main changes (triggered by a merged PR/MR)
    triggers {
        githubPush()
    }

    environment {
        MODAL_TOKEN_ID     = credentials('modal-token-id')
        MODAL_TOKEN_SECRET = credentials('modal-token-secret')
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install Modal') {
            steps {
                sh '''
                    python3 -m venv .venv
                    .venv/bin/pip install --quiet --upgrade pip
                    .venv/bin/pip install --quiet modal
                '''
            }
        }

        stage('Deploy to Modal') {
            when {
                branch 'main'
            }
            steps {
                sh '.venv/bin/modal deploy backend/modal_deploy.py'
            }
        }
    }

    post {
        success {
            echo "✅ Deployed to Modal: https://joshua-alfred--tamil-transcriber-tamiltranscriber-web.modal.run"
        }
        failure {
            echo "❌ Modal deploy failed — check logs above."
        }
    }
}
