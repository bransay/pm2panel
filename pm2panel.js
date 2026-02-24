//##############################################################################
//                             config panel
//##############################################################################
const PORT = 3001;
const PAM_AUTH = false;
const USER = 'admin';
const PASS = 'admin';
const SESSION_AGE = 10 * 60 * 1000;
const SESSION_AGE_REMEMBER = 7 * 24 * 60 * 60 * 1000;

//##############################################################################
//                             inital packages
//##############################################################################

const path = require('path');
const express = require('express');
const app = express();
const exec = require("child_process").exec;
const fs = require('fs');
const { pamAuthenticate, pamErrors } = require('node-linux-pam');

var session = require('express-session');

app.use(session({
    secret: 'keyboard cat',
    cookie: { maxAge: SESSION_AGE },
    resave: false,
    saveUninitialized: false
}));

app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use(express.static(path.join(__dirname, 'www')));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//##############################################################################
//                             auth middleware
//##############################################################################

function requireAuth(req, res, next) {
    if (req.session.islogin) {
        return next();
    }
    if (req.xhr || req.headers.accept?.indexOf('json') > -1 || req.path.startsWith('/api')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    res.redirect('/');
}

//##############################################################################
//                             rounting urls
//##############################################################################

app.get('/', function (req, res) {
    res.sendFile(path.join(__dirname, 'www/index.html'));
});

app.get('/login', function (req, res) {
    res.redirect('/');
});

app.post('/loginCheck', function (req, res) {
    const remember = req.body.remember === '1' || req.body.remember === true;
    
    const handleSuccess = () => {
        req.session.islogin = true;
        if (remember) {
            req.session.cookie.maxAge = SESSION_AGE_REMEMBER;
        }
        if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
            return res.json({ success: true });
        }
        res.redirect('/');
    };

    const handleFailure = () => {
        if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        res.redirect('/');
    };

    if (PAM_AUTH) {
        pamAuthenticate({
            username: req.body.username,
            password: req.body.passwd
        }, (err, code) => {
            if (!err) {
                handleSuccess();
            } else {
                if (code != 7) console.log('Unsuccessful PAM authentication, code: ' + code);
                handleFailure();
            }
        });
    } else {
        if (req.body.username === USER && req.body.passwd === PASS) {
            handleSuccess();
        } else {
            handleFailure();
        }
    }
});

app.get('/getProccess', requireAuth, function (req, res) {
    res.setHeader('Content-Type', 'application/json');
    exec("pm2 jlist", (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ error: error.message });
        }
        try {
            const data = JSON.parse(stdout);
            res.json(data);
        } catch (e) {
            res.status(500).json({ error: 'Failed to parse PM2 output' });
        }
    });
});

app.post('/addProccess', requireAuth, function (req, res) {
    if (!req.body.path) {
        return res.status(400).json({ error: 'Path is required' });
    }

    if (!fs.existsSync(req.body.path)) {
        return res.status(400).json({ error: 'File does not exist' });
    }

    exec('pm2 start "' + req.body.path + '"', (error, stdout, stderr) => {
        if (error) {
            return res.json({ success: false, message: error.message + stderr });
        }
        res.json({ success: true, message: 'Process started successfully' });
    });
});

app.get('/restart', requireAuth, function (req, res) {
    if (!req.query.id) {
        return res.status(400).json({ error: 'ID is required' });
    }

    exec("pm2 restart " + req.query.id, (error, stdout, stderr) => {
        if (error) {
            return res.json({ success: false, message: error.message + stderr });
        }
        res.json({ success: true, message: 'Process restarted' });
    });
});

app.get('/start', requireAuth, function (req, res) {
    if (!req.query.id) {
        return res.status(400).json({ error: 'ID is required' });
    }

    exec("pm2 start " + req.query.id, (error, stdout, stderr) => {
        if (error) {
            return res.json({ success: false, message: error.message + stderr });
        }
        res.json({ success: true, message: 'Process started' });
    });
});

app.get('/stop', requireAuth, function (req, res) {
    if (!req.query.id) {
        return res.status(400).json({ error: 'ID is required' });
    }

    exec("pm2 stop " + req.query.id, (error, stdout, stderr) => {
        if (error) {
            return res.json({ success: false, message: error.message + stderr });
        }
        res.json({ success: true, message: 'Process stopped' });
    });
});

app.get('/delete', requireAuth, function (req, res) {
    if (!req.query.id) {
        return res.status(400).json({ error: 'ID is required' });
    }

    exec("pm2 delete " + req.query.id, (error, stdout, stderr) => {
        if (error) {
            return res.json({ success: false, message: error.message + stderr });
        }
        res.json({ success: true, message: 'Process deleted' });
    });
});

app.get('/dump', requireAuth, function (req, res) {
    exec("pm2 save", (error, stdout, stderr) => {
        if (error) {
            return res.json({ success: false, message: error.message + stderr });
        }
        res.json({ success: true, message: 'Processes saved' });
    });
});

app.get('/notification', requireAuth, function (req, res) {
    if (!req.session.notication) {
        return res.send('-');
    }
    const message = req.session.notication;
    delete req.session.notication;
    res.send(message);
});

app.get('/folder', requireAuth, function (req, res) {
    const chosenPath = req.query.path || '/';
    
    res.setHeader('Content-Type', 'application/json');

    if (!fs.existsSync(chosenPath)) {
        return res.json([]);
    }

    fs.readdir(chosenPath, (err, files) => {
        if (err) {
            return res.json([]);
        }

        const lst = [];
        const normalizedPath = chosenPath.replace(/\/+$/, '') + '/';
        const parentPath = path.join(chosenPath, '..');
        lst.push({ name: '..', path: parentPath });

        files.forEach(file => {
            try {
                const fullPath = path.join(chosenPath, file);
                const stats = fs.statSync(fullPath);
                lst.push({
                    name: file,
                    path: fullPath,
                    isDirectory: stats.isDirectory()
                });
            } catch (e) {
                lst.push({ name: file, path: normalizedPath + file, isDirectory: false });
            }
        });

        res.json(lst);
    });
});

app.get('/logout', function (req, res) {
    req.session.destroy();
    if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
        return res.json({ success: true });
    }
    res.redirect('/');
});

app.get('/log', requireAuth, function (req, res) {
    if (!req.query.id) {
        return res.status(400).json({ error: 'ID is required' });
    }

    exec("pm2 log " + req.query.id + " --lines 100 --nostream", (error, stdout, stderr) => {
        if (error) {
            return res.send(stderr || error.message);
        }
        res.send(stdout);
    });
});

//##############################################################################
//                              finalize
//##############################################################################

app.listen(PORT, function () {
    console.log('pm2panel app listening on port ' + PORT + '! \n test: http://localhost:' + PORT);
});