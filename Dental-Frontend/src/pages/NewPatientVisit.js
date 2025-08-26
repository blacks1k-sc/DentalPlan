import React, { useEffect, useState } from "react"
import img2D from "../assets/images/2D.svg"
import img3D from "../assets/images/3D.svg"
import { saveImageToFolder } from "helpers/ImageUploaders/ImageUpload"
import {
    Card,
    CardBody,
    Col,
    Row,
    Table,
    FormGroup,
    Form,
    InputGroup,
    Input,
    Nav,
    NavItem,
    NavLink,
    TabContent,
    TabPane,
    CardText,
    Spinner,
    Label
} from "reactstrap"
import Switch from "react-switch"
import classnames from "classnames"
import { connect } from "react-redux";
import Dropzone from "react-dropzone"
import { Link } from "react-router-dom"
import { Navigate } from "react-router-dom";
//Import Action to copy breadcrumb items from local state to redux state
import { setBreadcrumbItems } from "../store/actions";
import Flatpickr from "react-flatpickr"
import 'flatpickr/dist/flatpickr.min.css';
import axios from "axios"
import sessionManager from "utils/sessionManager"
import { logErrorToServer } from "utils/logError"
const NewPatient = (props) => {
    const apiUrl = process.env.REACT_APP_NODEAPIURL;
    document.title = "Patient Visit | Oral Wisdom";
    const [loading, setLoading] = useState(false);
    const [dateOfXray, setDateOfXray] = useState(new Date());
    const [dateOfVisit, setDateOfVisit] = useState(new Date());
    const [notes, setNotes] = useState('');
    const [summary, setSummary] = useState('');
    const [model, setModel] = useState("Segmentation Model");

    const breadcrumbItems = [
        { title: `${sessionManager.getItem('firstName')} ${sessionManager.getItem('lastName')}`, link: "/practiceList" },
        { title: sessionManager.getItem('practiceName'), link: "/patientList" },
        { title: sessionManager.getItem('patientName'), link: "/patientImagesList" },
        { title: "New Visit", link: "/patientImagesList" },
    ]
    const [patientId, setPatientId] = useState('');
    useEffect(() => {
        props.setBreadcrumbItems('Patient Visit', breadcrumbItems)
        if (sessionManager.getItem('patientId')) {
            setPatientId(sessionManager.getItem('patientId'));
        }
        if (sessionManager.getItem('visitId')) {
            const getVisitDetails = async () => {
                const response = await axios.get(`${apiUrl}/getVisitDetailsById?visitID=` + sessionManager.getItem('visitId'),
                    {
                        headers: {
                            Authorization: sessionManager.getItem('token')
                        }
                    }); // Adjust the API endpoint as needed
                // console.log(response);
                sessionManager.setItem('token', response.headers['new-token'])
                setDateOfVisit(response.data.visitDetails[0].date_of_visit);
                setDateOfXray(response.data.visitDetails[0].date_of_xray);
                setNotes(response.data.visitDetails[0].notes);
                setSummary(response.data.visitDetails[0].summary);
            }
            getVisitDetails()
        }
    }, [])

    const [customActiveTab, setCustomActiveTab] = useState("1");

    // Function to toggle the active tab
    const toggleCustom = (tabId) => {
        setCustomActiveTab(tabId);
    };

    const [selectedFiles, setselectedFiles] = useState([])
    function handleAcceptedFiles(files) {
        files.map(file =>
            Object.assign(file, {
                preview: URL.createObjectURL(file),
                formattedSize: formatBytes(file.size),
            })
        )
        let updatedFiles = selectedFiles
        files.map(element => {
            updatedFiles = [...updatedFiles, element]
        });
        setselectedFiles(updatedFiles);
    }

    const handlePatientVisitSubmit = async () => {
        if (dateOfVisit !== "" && dateOfXray !== "") {
            try {
                let response;
                //console.log('handlePatientVisitSubmit : ' + patientId);
                if (sessionManager.getItem('visitId')) {
                    response = await axios.post(`${apiUrl}/update-patientVisit`, {
                        visitId: sessionManager.getItem('visitId'), date_of_xray: dateOfXray, notes: notes,
                        date_of_visit: dateOfVisit, summary: summary
                    },
                        {
                            headers: {
                                Authorization: sessionManager.getItem('token')
                            }
                        });
                    if (response.status === 200) {
                        sessionManager.setItem('xrayDate', dateOfXray)
                        sessionManager.setItem('token', response.headers['new-token'])
                        toggleCustom("2");
                    }
                }
                else {
                    response = await axios.post(`${apiUrl}/add-patientVisit`, {
                        //    response = await axios.post('http://localhost:3001/add-patientVisit', {  
                        patientId: patientId, date_of_xray: dateOfXray, notes: notes, date_of_visit: dateOfVisit, summary: summary,
                        created_by: "test"
                    },
                        {
                            headers: {
                                Authorization: sessionManager.getItem('token')
                            }
                        })
                    //console.log(response)
                    if (response.status === 200) {
                        sessionManager.setItem('visitId', response.data.visitDetail._id);
                        sessionManager.setItem('token', response.headers['new-token'])
                        toggleCustom("2");
                    }
                }
            }
            catch (err) {
                logErrorToServer(err, "handlePatientVisitSubmit");
                console.error(err)
            }
        }
    }

    function formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return "0 Bytes"
        const k = 1024
        const dm = decimals < 0 ? 0 : decimals
        const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]

        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i]
    }
    const [redirect, setRedirect] = useState(false);
    const [message, setMessage] = useState('')
    const [cancelRedirect, setCancelRedirect] = useState(false)
    const handleSubmit = async () => {
        setLoading(true);
        const results = await Promise.all(
            selectedFiles.map((file, index) => saveImageToFolder(file, patientId, index + 1, model))
        );
        const errors = results.filter(result => !result.success).map(result => result.error);
        setLoading(false);
        if (errors.length > 0) {
            console.error('Errors:', errors); // Optionally log errors for debugging
            setMessage(`${errors.length} files failed to upload:\n${errors.join('\n')}`);
            return;
        }
        sessionManager.setItem("xrayDate", dateOfXray)
        // Set success states if no errors occurred
        sessionManager.setItem('last', true);
        sessionManager.setItem('first', false);
        setRedirect(true);
    };

    const handleModelChange = () => {
        if (model === "Old Model") {
            setModel("Segmentation Model")
        }
        else {
            setModel("Old Model")
        }
    }
    if (redirect) {
        return <Navigate to="/annotationPage" />;
    }
    if (cancelRedirect) {
        return <Navigate to="/patientImagesList" />;
    }
    return (
        <React.Fragment>
            {loading ?
                <Row className="justify-content-center align-items-center" style={{ minHeight: '80vh' }}>
                    <Col xs="12" sm="8" md="6" lg="4">
                        <Card>
                            <CardBody className="text-center">
                                <Spinner color="primary" style={{ width: '3rem', height: '3rem' }} />
                                <p className="mt-3">Loading Please Wait...</p>
                            </CardBody>
                        </Card>
                    </Col>
                </Row>
                :
                <Row>
                    <Col>
                        <Card>
                            <CardBody>
                                <Nav tabs className="nav-tabs-custom">
                                    <NavItem>
                                        <NavLink disabled={customActiveTab !== "1" ? true : false}
                                            style={{ cursor: "pointer" }}
                                            className={classnames({
                                                active: customActiveTab === "1",
                                            })}
                                            onClick={() => toggleCustom("1")}
                                        >
                                            <span className="d-none d-sm-block">Patient's Visit</span>
                                        </NavLink>
                                    </NavItem>
                                    <NavItem>
                                        <NavLink disabled={customActiveTab !== "2" ? true : false}
                                            style={{ cursor: "pointer" }}
                                            className={classnames({
                                                active: customActiveTab === "2",
                                            })}
                                            onClick={() => toggleCustom("2")}
                                        >
                                            <span className="d-none d-sm-block">Image Upload</span>
                                        </NavLink>
                                    </NavItem>
                                </Nav>

                                <TabContent activeTab={customActiveTab} className="p-3 text-muted">
                                    <TabPane tabId="1">
                                        <Row className="mb-3">
                                            <label
                                                htmlFor="example-email-input"
                                                className="col-md-3 col-form-label"
                                            >
                                                Date of Visit
                                            </label>
                                            <div className="col-md-9">
                                                <InputGroup>
                                                    <Flatpickr
                                                        className="form-control d-block"
                                                        placeholder="MMM dd, yyyy"
                                                        id="example-date-input"
                                                        options={{
                                                            dateFormat: "M d, Y"
                                                        }}
                                                        value={dateOfVisit}
                                                        onChange={(selectedDates) => {
                                                            // const formattedDate = selectedDates.length > 0 
                                                            //     ? selectedDates[0].toLocaleDateString("en-GB") // Format to dd/mm/yyyy
                                                            //     : "";
                                                            setDateOfVisit(selectedDates[0]);
                                                            //setDisplayDateOfXray(selectedDates[0]);
                                                        }}
                                                    />
                                                </InputGroup>
                                            </div>
                                        </Row>
                                        <Row className="mb-3">
                                            <label
                                                htmlFor="example-email-input"
                                                className="col-md-3 col-form-label"
                                            >
                                                Date of X-ray
                                            </label>
                                            <div className="col-md-9">
                                                <InputGroup>
                                                    <Flatpickr
                                                        className="form-control d-block"
                                                        placeholder="MMM dd, yyyy"
                                                        id="example-date-input"
                                                        options={{
                                                            dateFormat: "M d, Y"
                                                        }}
                                                        value={dateOfXray}
                                                        onChange={(selectedDates) => {
                                                            // const formattedDate = selectedDates.length > 0 
                                                            //     ? selectedDates[0].toLocaleDateString("en-GB") // Format to dd/mm/yyyy
                                                            //     : "";
                                                            setDateOfXray(selectedDates[0]);
                                                            //setDisplayDateOfXray(selectedDates[0]);
                                                        }}
                                                    />
                                                </InputGroup>
                                            </div>
                                        </Row>
                                        <Row className="mb-3">
                                            <label
                                                htmlFor="example-email-input"
                                                className="col-md-3 col-form-label"
                                            >
                                                Summary
                                            </label>
                                            <div className="col-md-9">
                                                <Input
                                                    type="textarea"
                                                    id="textarea"
                                                    rows="3"
                                                    onChange={(e) => { setSummary(e.target.value) }}
                                                    value={summary}
                                                />
                                            </div>
                                        </Row>
                                        <Row className="mb-3">
                                            <label
                                                htmlFor="example-email-input"
                                                className="col-md-3 col-form-label"
                                            >
                                                Notes
                                            </label>
                                            <div className="col-md-9">
                                                <Input
                                                    type="textarea"
                                                    id="textarea"
                                                    rows="6"
                                                    onChange={(e) => { setNotes(e.target.value) }}
                                                    value={notes}
                                                />
                                            </div>
                                        </Row>
                                        <Row className="mb-3">
                                            <label
                                                htmlFor="example-email-input"
                                                className="col-md-3 col-form-label"
                                            >
                                                Image Type
                                            </label>
                                            <div className="col-md-9">
                                                {/* <button onClick={() => toggleCustom("3")} style={{
                                                    border: 'none',
                                                    background: 'none',
                                                    padding: 0,
                                                    cursor: 'pointer',
                                                }}

                                                > */}
                                                <img
                                                    className="img-thumbnail"
                                                    alt="AGP"
                                                    width="200"
                                                    src={img2D}
                                                />
                                                {/* </button> */}

                                                {"  "}
                                                <img
                                                    className="img-thumbnail"
                                                    alt="Lexa"
                                                    width="200"
                                                    src={img3D}
                                                />
                                            </div>
                                        </Row>
                                        <Row className="mb-3">
                                            <div className="text-center mt-4">
                                                <button onClick={() => { handlePatientVisitSubmit() }}
                                                    type="button"
                                                    className="btn btn-primary waves-effect waves-light"
                                                >
                                                    Next
                                                </button>
                                            </div>
                                        </Row>
                                    </TabPane>
                                    <TabPane tabId="2">
                                        <Row>
                                            <Col sm="12">
                                                <Form>
                                                    <Dropzone
                                                        onDrop={acceptedFiles => {
                                                            handleAcceptedFiles(acceptedFiles)
                                                        }}
                                                    >
                                                        {({ getRootProps, getInputProps }) => (
                                                            <div className="dropzone dz-clickable">
                                                                <div
                                                                    className="dz-message needsclick"
                                                                    {...getRootProps()}
                                                                >
                                                                    <input {...getInputProps()} />
                                                                    <div className="mb-3">
                                                                        <i className="mdi mdi-cloud-upload-outline text-muted display-4"></i>
                                                                    </div>
                                                                    <h4>Drop files here or click to upload.</h4>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </Dropzone>
                                                    <div className="dropzone-previews mt-3" id="file-previews">
                                                        {selectedFiles.map((file, index) => (
                                                            <Card
                                                                className="mt-1 mb-0 shadow-none border dz-processing dz-image-preview dz-success dz-complete"
                                                                key={`${index}-file`}
                                                            >
                                                                <div className="p-2">
                                                                    <Row className="align-items-center">
                                                                        <Col className="col-auto">
                                                                            <img
                                                                                data-dz-thumbnail=""
                                                                                height="80"
                                                                                className="avatar-sm rounded bg-light"
                                                                                alt={file.name}
                                                                                src={file.preview}
                                                                            />
                                                                        </Col>
                                                                        <Col>
                                                                            <Link to="#" className="text-muted font-weight-bold">
                                                                                {file.name}
                                                                            </Link>
                                                                            <p className="mb-0">
                                                                                <strong>{file.formattedSize}</strong>
                                                                            </p>
                                                                        </Col>
                                                                    </Row>
                                                                </div>
                                                            </Card>
                                                        ))}
                                                    </div>
                                                    <FormGroup switch className="mb-3 d-flex align-items-center">
                                                        <Label className="mr-3 mb-0">PC Model</Label> {/* Left label */}
                                                        <Input
                                                            type="switch"
                                                            id="modelSwitch"
                                                            checked={!(model === "Old Model")}
                                                            onChange={handleModelChange}
                                                            // style={{backgroundColor: "#7a6fbe", borderColor: "#7a6fbe"}}
                                                            className="mx-2" // Add margin around switch for spacing
                                                        />
                                                        <Label className="ml-3 mb-0">Internet Model</Label> {/* Right label */}
                                                    </FormGroup>
                                                </Form>
                                            </Col>
                                        </Row>
                                        <Row className="mb-3">
                                            <div className="text-center mt-4">
                                                <button onClick={() => { handleSubmit() }}
                                                    type="button"
                                                    className="btn btn-primary waves-effect waves-light"
                                                    disabled={selectedFiles.length === 0}
                                                >
                                                    Submit
                                                </button>
                                                {message !== '' ? <button onClick={() => { setCancelRedirect(true) }}
                                                    type="button"
                                                    className="btn btn-primary waves-effect waves-light"
                                                    style={{ marginLeft: '1%' }}
                                                >
                                                    Cancel
                                                </button> : <></>}
                                            </div>
                                        </Row>
                                        {message !== '' ? <Row>
                                            <div className="text-center mt-4" style={{ color: 'red', whiteSpace: 'pre-line' }}>
                                                {message}
                                            </div>
                                        </Row> : <></>}
                                    </TabPane>
                                </TabContent>
                            </CardBody>
                        </Card>
                    </Col>
                </Row>}
        </React.Fragment>
    )
}

export default connect(null, { setBreadcrumbItems })(NewPatient);